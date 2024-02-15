const OpenAI = require("openai");
const { body, validationResult } = require("express-validator");
const multer = require("multer");
require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

process.on("uncaughtException", function (err) {
  console.log(err);
});

// const auth = require('./routes/auth')
// const preview = require('./routes/preview')
// const checkAuth = require('./middleware/auth-middleware')
const cors = require("cors");
const {
  sequelize,
  handleAssistantCreate,
  getList,
  deleteAssistant,
  handleImageCreate,
  handleReviewThumbnail,
  getFileList,
  getImageURL,
  insertThumbnail,
  getThumbnails,
} = require("./data/local/database");
const bodyParser = require("body-parser");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const path = require("path");

const port = 3005;

app.use(cors());

// create application/json parser
const jsonParser = bodyParser.json();

// Multer configuration for single file uploads
const upload = multer({
  storage: multer.diskStorage({
    /*...*/
  }),
});

const memoryupload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // limit to 5MB
  },
});

app.post("/thumbnail-review/create-assistant", async (req, res) => {
  try {
    await handleAssistantCreate(req, res);
  } catch (error) {

    res.status(500).send({ error: "Internal Server Error" });
  }
});

app.get("/get-assistants", getList);

app.delete("/delete-assistant", deleteAssistant);

app.get("/get-file-list", getFileList);
app.post("/image-create", handleImageCreate);

app.post(
  "/review-thumbnail",
  upload.single("file"),
  [
    body("userName").notEmpty().withMessage("User name is required"),
    body("userEmail").isEmail().withMessage("Valid email is required"),
    body("transcription").notEmpty().withMessage("Transcription is required"),
    body("imageUrl").notEmpty().withMessage("Image URL is required"),
    // Add other validation rules as needed
  ],
  handleReviewThumbnail
);

app.post("/save-database", memoryupload.single("file"), getImageURL);

app.post("/thumbnail-data", insertThumbnail);
app.get("/get-all-thumbnails", getThumbnails);
sequelize
  .sync()
  .then(async () => {
    console.log("Database and tables created!");
  })
  .catch((err) => {
    console.error("Error syncing database:", err);
  });

app.listen(port, () => {
  console.log(`listening on port : ${port}`);
});
