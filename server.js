require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const { promisify } = require("node:util");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const multer = require("multer");
const { MongoClient, ObjectId } = require("mongodb");
const nodemailer = require("nodemailer");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OWNER_EMAIL = process.env.OWNER_EMAIL || "snehasishxofficial@gmail.com";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ATTACHMENT_SIZE = 4 * 1024 * 1024;
const ADMIN_SESSIONS_COLLECTION = "adminSessions";
const RATE_LIMITS_COLLECTION = "rateLimits";
const applicationStatuses = [
  "New",
  "Reviewing",
  "Call Scheduled",
  "Proposal Sent",
  "Won",
  "Rejected",
  "On Hold"
];
const allowedServices = [
  "Website",
  "Database",
  "API",
  "Authentication",
  "3D experience",
  "Admin panel"
];
const allowedAttachmentTypes = new Map([
  [".pdf", new Set(["application/pdf"])],
  [".doc", new Set(["application/msword", "application/octet-stream"])],
  [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"])],
  [".png", new Set(["image/png"])],
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".webp", new Set(["image/webp"])]
]);
const scrypt = promisify(crypto.scrypt);
let mongoClient;
let db;
let databaseConnection;
let mailTransport;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

async function connectToDatabase() {
  if (db) return db;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  if (!databaseConnection) {
    const client = new MongoClient(process.env.MONGODB_URI);
    mongoClient = client;
    databaseConnection = (async () => {
      try {
        await client.connect();
        const connectedDb = client.db(process.env.MONGODB_DB || "buildedlabs");
        await Promise.all([
          connectedDb.collection("applications").createIndex({ createdAt: -1 }),
          connectedDb.collection("applications").createIndex({ status: 1, createdAt: -1 }),
          connectedDb.collection("messages").createIndex({ createdAt: -1 }),
          connectedDb.collection(ADMIN_SESSIONS_COLLECTION).createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 0 }
          ),
          connectedDb.collection(RATE_LIMITS_COLLECTION).createIndex(
            { resetAt: 1 },
            { expireAfterSeconds: 0 }
          )
        ]);
        db = connectedDb;
        return connectedDb;
      } catch (error) {
        databaseConnection = undefined;
        mongoClient = undefined;
        try {
          await client.close();
        } catch (closeError) {
          console.error("MongoDB client cleanup failed.", closeError);
        }
        throw error;
      }
    })();
  }
  return databaseConnection;
}

app.use("/api", async (req, res, next) => {
  if (req.path === "/health") return next();
  try {
    await connectToDatabase();
    return next();
  } catch (error) {
    return next(error);
  }
});

class MongoRateLimitStore {
  constructor(scope) {
    this.scope = scope;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  getKey(key) {
    const keyHash = crypto.createHash("sha256").update(key).digest("hex");
    return `${this.scope}:${keyHash}`;
  }

  async increment(key) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.windowMs);
    const _id = this.getKey(key);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const document = await db.collection(RATE_LIMITS_COLLECTION).findOneAndUpdate(
          { _id },
          [{
            $set: {
              totalHits: {
                $cond: [
                  { $gt: ["$resetAt", now] },
                  { $add: [{ $ifNull: ["$totalHits", 0] }, 1] },
                  1
                ]
              },
              resetAt: {
                $cond: [{ $gt: ["$resetAt", now] }, "$resetAt", resetAt]
              }
            }
          }],
          { upsert: true, returnDocument: "after" }
        );
        if (!document) throw new Error("MongoDB did not return the updated rate-limit record.");
        return { totalHits: document.totalHits, resetTime: document.resetAt };
      } catch (error) {
        if (error.code !== 11000 || attempt > 0) throw error;
      }
    }
    throw new Error("MongoDB could not update the rate-limit record.");
  }

  async decrement(key) {
    await db.collection(RATE_LIMITS_COLLECTION).updateOne(
      { _id: this.getKey(key) },
      [{ $set: { totalHits: { $max: [0, { $subtract: ["$totalHits", 1] }] } } }]
    );
  }

  async resetKey(key) {
    await db.collection(RATE_LIMITS_COLLECTION).deleteOne({ _id: this.getKey(key) });
  }
}

const loginLimiter = rateLimit({
  store: new MongoRateLimitStore("login"),
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait and try again." }
});
const publicFormLimiter = rateLimit({
  store: new MongoRateLimitStore("public-forms"),
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many submissions. Please wait and try again." }
});

function isEmail(value) {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validateApplication(body) {
  const company = cleanText(body.company, 160);
  const contactName = cleanText(body.contactName, 160);
  const email = cleanText(body.email, 254).toLowerCase();
  const phone = cleanText(body.phone, 40);
  const website = cleanText(body.website, 300);
  const industry = cleanText(body.industry, 100);
  const size = cleanText(body.size, 80);
  const description = cleanText(body.description, 5000);
  const reason = cleanText(body.reason, 3000);
  const budget = cleanText(body.budget, 100);
  const timeline = cleanText(body.timeline, 100);
  const submittedServices = Array.isArray(body.services)
    ? body.services
    : typeof body.services === "string" ? [body.services] : [];
  const services = [...new Set(submittedServices.filter((service) => allowedServices.includes(service)))];

  if (!company || !contactName || !phone || !isEmail(email)) {
    return { error: "Enter a company, contact name, valid email and phone number." };
  }
  if (website && !/^https?:\/\/\S+$/i.test(website)) {
    return { error: "Enter a valid website URL or leave that field empty." };
  }
  if (services.length === 0 || !description || description.length < 50 || !reason) {
    return { error: "Choose a service and complete the project description and reason fields." };
  }
  if (body.consent !== "on" && body.consent !== true) {
    return { error: "Consent is required before submitting an application." };
  }

  return {
    application: {
      company,
      contactName,
      email,
      phone,
      website,
      industry,
      size,
      services,
      description,
      reason,
      budget,
      timeline,
      status: "New",
      notes: "",
      replies: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  };
}

function validateOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get("host")) {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }
  } catch {
    return res.status(403).json({ error: "Request origin is not allowed." });
  }
  return next();
}

function setSessionCookie(res, token) {
  res.cookie("buildedlabs_admin", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie("buildedlabs_admin", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/"
  });
}

function getSessionToken(req) {
  return req.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("buildedlabs_admin="))
    ?.slice("buildedlabs_admin=".length);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  if (!token) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  try {
    const result = await db.collection(ADMIN_SESSIONS_COLLECTION).updateOne(
      { _id: hashSessionToken(token), expiresAt: { $gt: new Date() } },
      { $set: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } }
    );
    if (!result.matchedCount) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Please sign in to continue." });
    }
    setSessionCookie(res, token);
    return next();
  } catch (error) {
    return next(error);
  }
}

function parsePasswordHash(encodedHash) {
  const [algorithm, saltEncoded, hashEncoded] = (encodedHash || "").split("$");
  if (algorithm !== "scrypt" || !saltEncoded || !hashEncoded) {
    throw new Error("ADMIN_PASSWORD_HASH must use the scrypt$salt$hash format.");
  }
  const salt = Buffer.from(saltEncoded, "base64");
  const hash = Buffer.from(hashEncoded, "base64");
  if (salt.length < 16 || hash.length !== 64) {
    throw new Error("ADMIN_PASSWORD_HASH has an invalid salt or hash.");
  }
  return { salt, hash };
}

async function passwordMatches(password) {
  const { salt, hash } = parsePasswordHash(process.env.ADMIN_PASSWORD_HASH);
  const candidate = await scrypt(password, salt, hash.length);
  return crypto.timingSafeEqual(hash, candidate);
}

function getMailTransport() {
  if (mailTransport) return mailTransport;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!host || !user || !pass || !from) return null;

  mailTransport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass }
  });
  return mailTransport;
}

function escapeCsv(value) {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function publicApplication(application) {
  const { attachment, ...publicFields } = application;
  return {
    ...publicFields,
    attachment: attachment
      ? { filename: attachment.filename, contentType: attachment.contentType, size: attachment.size || 0 }
      : null
  };
}

function attachmentBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data && typeof data.value === "function") return data.value(true);
  return Buffer.from(data || []);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const supportedTypes = allowedAttachmentTypes.get(extension);
    if (!supportedTypes || !supportedTypes.has(file.mimetype)) {
      return callback(new Error("Attachment must be a PDF, DOC, DOCX, PNG, JPG or WEBP file."));
    }
    return callback(null, true);
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/applications", publicFormLimiter, upload.single("attachment"), async (req, res, next) => {
  try {
    if (req.body.websiteConfirm) {
      return res.status(400).json({ error: "Application could not be submitted." });
    }
    const validation = validateApplication(req.body);
    if (validation.error) return res.status(400).json({ error: validation.error });

    const application = validation.application;
    if (req.file) {
      application.attachment = {
        filename: path.basename(req.file.originalname).replace(/[^\w.-]/g, "_").slice(0, 150),
        contentType: req.file.mimetype,
        size: req.file.size,
        data: req.file.buffer
      };
    }

    const result = await db.collection("applications").insertOne(application);
    const transport = getMailTransport();
    if (transport && process.env.NOTIFY_OWNER_ON_APPLICATION === "true") {
      try {
        await transport.sendMail({
          from: process.env.SMTP_FROM,
          to: OWNER_EMAIL,
          subject: `New project application: ${application.company}`,
          text: `New application from ${application.contactName} (${application.company}).\nEmail: ${application.email}\nServices: ${application.services.join(", ")}\n\nSign in to the Buildedlabs admin panel to review it.`
        });
      } catch (mailError) {
        console.error("New application notification email failed.", mailError);
      }
    }
    return res.status(201).json({ id: result.insertedId.toString(), message: "Application received." });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/contact", publicFormLimiter, async (req, res, next) => {
  try {
    const name = cleanText(req.body.name, 160);
    const email = cleanText(req.body.email, 254).toLowerCase();
    const message = cleanText(req.body.message, 5000);
    if (!name || !isEmail(email) || !message) {
      return res.status(400).json({ error: "Enter your name, a valid email and a message." });
    }
    await db.collection("messages").insertOne({
      name,
      email,
      message,
      isRead: false,
      replied: false,
      createdAt: new Date()
    });
    return res.status(201).json({ message: "Message received." });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/login", validateOrigin, loginLimiter, async (req, res, next) => {
  try {
    const username = cleanText(req.body.username, 120);
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
      return res.status(503).json({ error: "Admin login is not configured on this server." });
    }
    const usernameMatches = crypto.timingSafeEqual(
      crypto.createHash("sha256").update(username).digest(),
      crypto.createHash("sha256").update(process.env.ADMIN_USERNAME).digest()
    );
    if (!usernameMatches || !password || !(await passwordMatches(password))) {
      return res.status(401).json({ error: "Username or password is incorrect." });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    await db.collection(ADMIN_SESSIONS_COLLECTION).insertOne({
      _id: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    });
    setSessionCookie(res, token);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/session", async (req, res, next) => {
  const token = getSessionToken(req);
  if (!token) {
    clearSessionCookie(res);
    return res.json({ authenticated: false });
  }
  try {
    const result = await db.collection(ADMIN_SESSIONS_COLLECTION).updateOne(
      { _id: hashSessionToken(token), expiresAt: { $gt: new Date() } },
      { $set: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } }
    );
    if (!result.matchedCount) {
      clearSessionCookie(res);
      return res.json({ authenticated: false });
    }
    setSessionCookie(res, token);
    return res.json({ authenticated: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/logout", validateOrigin, requireAdmin, async (req, res, next) => {
  const token = getSessionToken(req);
  try {
    if (token) await db.collection(ADMIN_SESSIONS_COLLECTION).deleteOne({ _id: hashSessionToken(token) });
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/applications/export.csv", requireAdmin, async (req, res, next) => {
  try {
    const applications = await db.collection("applications")
      .find({}, { projection: { attachment: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    const columns = ["createdAt", "status", "company", "contactName", "email", "phone", "website", "industry", "size", "services", "budget", "timeline", "description", "reason", "notes"];
    const rows = applications.map((application) => columns.map((column) => {
      const value = column === "services" ? (application.services || []).join(", ") : application[column];
      return escapeCsv(value);
    }).join(","));
    res.type("text/csv").attachment("buildedlabs-applications.csv")
      .send([columns.join(","), ...rows].join("\r\n"));
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/applications", requireAdmin, async (req, res, next) => {
  try {
    const status = cleanText(req.query.status, 40);
    const service = cleanText(req.query.service, 40);
    const search = cleanText(req.query.search, 120);
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const filter = {};
    if (applicationStatuses.includes(status)) filter.status = status;
    if (allowedServices.includes(service)) filter.services = service;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { company: { $regex: escaped, $options: "i" } },
        { contactName: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } }
      ];
    }
    const collection = db.collection("applications");
    const [applications, total] = await Promise.all([
      collection.find(filter, { projection: { attachment: 0 } })
        .sort({ createdAt: -1 })
        .skip((page - 1) * 25)
        .limit(25)
        .toArray(),
      collection.countDocuments(filter)
    ]);
    const [newCount, weekCount] = await Promise.all([
      collection.countDocuments({ status: "New" }),
      collection.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })
    ]);
    return res.json({
      applications: applications.map(publicApplication),
      total,
      page,
      summary: { new: newCount, thisWeek: weekCount }
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/messages", requireAdmin, async (req, res, next) => {
  try {
    const messages = await db.collection("messages")
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return res.json({ messages });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/applications/:id", requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid application ID." });
    const application = await db.collection("applications").findOne({
      _id: new ObjectId(req.params.id)
    }, { projection: { "attachment.data": 0 } });
    if (!application) return res.status(404).json({ error: "Application not found." });
    return res.json({ application: publicApplication(application) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/applications/:id/attachment", requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid application ID." });
    const application = await db.collection("applications").findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: { attachment: 1 } }
    );
    if (!application?.attachment) return res.status(404).json({ error: "Attachment not found." });
    res.set({
      "Content-Type": application.attachment.contentType,
      "Content-Disposition": `attachment; filename="${application.attachment.filename}"`,
      "X-Content-Type-Options": "nosniff"
    });
    return res.send(attachmentBuffer(application.attachment.data));
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/admin/applications/:id", validateOrigin, requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid application ID." });
    const update = { updatedAt: new Date() };
    if (typeof req.body.status === "string") {
      if (!applicationStatuses.includes(req.body.status)) {
        return res.status(400).json({ error: "Choose a valid application status." });
      }
      update.status = req.body.status;
    }
    if (typeof req.body.notes === "string") update.notes = cleanText(req.body.notes, 5000);
    if (Object.keys(update).length === 1) return res.status(400).json({ error: "No application changes were provided." });
    const result = await db.collection("applications").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Application not found." });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/applications/:id/reply", validateOrigin, requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid application ID." });
    const message = cleanText(req.body.message, 10000);
    if (!message) return res.status(400).json({ error: "Write a message before sending." });
    const transport = getMailTransport();
    if (!transport) {
      return res.status(503).json({ error: "SMTP is not configured. Add the SMTP settings to the server environment." });
    }
    const collection = db.collection("applications");
    const application = await collection.findOne({ _id: new ObjectId(req.params.id) });
    if (!application) return res.status(404).json({ error: "Application not found." });
    if ((application.replies || []).length >= 100) {
      return res.status(409).json({ error: "This application has reached the reply history limit." });
    }

    const reply = {
      _id: new ObjectId(),
      message,
      sentAt: null,
      status: "sending",
      createdAt: new Date()
    };
    const update = await collection.updateOne(
      { _id: application._id },
      { $push: { replies: reply }, $set: { updatedAt: new Date() } }
    );
    if (!update.matchedCount) return res.status(404).json({ error: "Application not found." });

    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: application.email,
        replyTo: OWNER_EMAIL,
        subject: `Re: Your Buildedlabs project enquiry`,
        text: `Hi ${application.contactName},\n\n${message}\n\nRegards,\nSnehasish Das\nBuildedlabs\n${OWNER_EMAIL}\n+91 74391 15647`
      });
    } catch (mailError) {
      await collection.updateOne(
        { _id: application._id, "replies._id": reply._id },
        { $set: { "replies.$.status": "failed" } }
      );
      console.error("SMTP reply failed for application.", mailError);
      return res.status(502).json({ error: "Email could not be sent. Check SMTP settings and try again." });
    }

    try {
      await collection.updateOne(
        { _id: application._id, "replies._id": reply._id },
        { $set: { "replies.$.status": "sent", "replies.$.sentAt": new Date() } }
      );
    } catch (historyError) {
      console.error("Email was sent but reply history could not be updated.", historyError);
      return res.status(500).json({ error: "The email was sent, but its history could not be updated. Refresh before retrying." });
    }
    return res.json({ ok: true, message: "Reply sent." });
  } catch (error) {
    return next(error);
  }
});

const publicFiles = new Set(["index.html", "styles.css", "script.js", "admin.html", "admin.css", "admin.js", "favicon.svg"]);
app.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) return next();
  const requestedFile = req.path === "/" ? "index.html" : req.path.slice(1);
  if (!publicFiles.has(requestedFile)) return next();
  return express.static(__dirname, {
    dotfiles: "deny",
    index: false,
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === "admin.html") {
        res.setHeader("Cache-Control", "no-store");
      }
    }
  })(req, res, next);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Attachment must be 4 MB or smaller."
      : "The attachment could not be uploaded.";
    return res.status(400).json({ error: message });
  }
  if (error.message?.startsWith("Attachment must be")) {
    return res.status(400).json({ error: error.message });
  }
  console.error("Request failed.", error);
  return res.status(500).json({ error: "The request could not be completed. Please try again." });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  if (!process.env.ADMIN_PASSWORD_HASH) throw new Error("ADMIN_PASSWORD_HASH is required.");
  await connectToDatabase();
  app.listen(PORT, () => {
    console.log(`Buildedlabs server listening on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Buildedlabs server could not start.", error.message);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      if (mongoClient) await mongoClient.close();
      process.exit(0);
    });
  }
}

module.exports = app;
