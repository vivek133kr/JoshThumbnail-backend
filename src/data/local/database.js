const fs = require("fs");
const fss = require("fs").promises;
const { body, validationResult } = require("express-validator");
const crypto = require("crypto"); // Import the crypto library
const path = require("path");
require("dotenv").config();

const OpenAI = require("openai");
const { Sequelize, DataTypes, Op } = require("sequelize");
const multer = require("multer");
const { Storage } = require("@google-cloud/storage");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "GOOGLE_APPLICATION_CREDENTIALS not defined in the environment."
  );
  process.exit(1);
}

// Parse the JSON string from .env directly (no need for JSON.parse)
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);

// Creates a client
const storage = new Storage({
  credentials, // Use the parsed credentials object
  projectId: "joshtalks-ias", // replace with your project id
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Database
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage:
    "/Users/user/Desktop/Thumbnail_review_system/server/src/server-data/josh-editor.sqlite",
});

// Calculate a unique hash for the image content
const calculateImageHash = async (imagePath) => {
  const fileBuffer = await fss.readFile(imagePath);
  const hash = crypto.createHash("sha256");
  hash.update(fileBuffer);
  return hash.digest("hex");
};

// Check if the image exists in the database based on its content hash

// Role model
const Thumbnails = sequelize.define(
  "Thumbnails",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userName: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    userEmail: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    fileId: {
      type: DataTypes.STRING, // Change the data type based on your requirements
      allowNull: false,
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    imageUrl: {
      type: DataTypes.TEXT,
      allowNull: false, // You might set this to false if the image is always required
    },
    approvalStatus: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    approvalStatusReason: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    contentHash: {
      type: DataTypes.STRING(64), // Adjust the length as needed
      allowNull: false,
    },
  },
  {
    tableName: "thumbnails",
  }
);

const findImageByContentHash = async (contentHash) => {
  const existingImage = await Thumbnails.findOne({ where: { contentHash } });
  return existingImage;
};
function processInput(input) {
  const resultRegex = /result:/i;
  const reasonRegex = /reason:/i;
  const warningRegex =
    /warning(?:s)?\/?recommendation(?:s)?|warning(?:s)? or recommendation(?:s)?/i;

  // Function to find the index and matched string of the regex match
  const findRegexMatch = (regex, str) => {
    const match = str.match(regex);
    return match ? { index: match.index, match: match[0] } : null;
  };

  let result = "",
    reason = "",
    warning = "";

  // Finding indices and matches of each section
  const resultMatch = findRegexMatch(resultRegex, input);
  const reasonMatch = findRegexMatch(reasonRegex, input);
  const warningMatch = findRegexMatch(warningRegex, input);

  // Extracting each section based on the found indices and matches
  if (resultMatch) {
    result = input
      .slice(
        resultMatch.index + resultMatch.match.length,
        reasonMatch ? reasonMatch.index : undefined
      )
      .trim();
  }

  if (reasonMatch) {
    reason = input
      .slice(
        reasonMatch.index + reasonMatch.match.length,
        warningMatch ? warningMatch.index : undefined
      )
      .trim();
  }

  if (warningMatch) {
    warning = input
      .slice(warningMatch.index + warningMatch.match.length)
      .trim();
    if (warning.startsWith(":")) {
      warning = warning.substring(1).trim();
    }
  }

  return { result, reason, warning };
}

async function insertThumbnail(req, res, fileId, processedData, contentHash) {
  try {
  

    const thumbnail = await Thumbnails.create({
      userName: req.body.userName,
      userEmail: req.body.userEmail,
      fileId: fileId,
      title: req.body.transcription,
      imageUrl: req.body.imageUrl,
      approvalStatus: processedData.result,
      approvalStatusReason: processedData.reason
        ? processedData.reason
        : "Approved, no reason",
      contentHash: contentHash,
    });

    return thumbnail;
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

async function updateThumbnailByContentHash(
  req,
  res,
  fileId,
  processedData,
  contentHash
) {
  try {
    const thumbnail = await Thumbnails.findOne({ where: { contentHash } });

    if (!thumbnail) {
      return res.status(404).json({ error: "Thumbnail not found" });
    }

    // Apply partial updates based on the arguments provided
    thumbnail.userName = req.body.userName || thumbnail.userName;
    thumbnail.userEmail = req.body.userEmail || thumbnail.userEmail;

    thumbnail.fileId = fileId;
    thumbnail.title = req.body.transcription || thumbnail.title;
    thumbnail.imageUrl = req.body.imageUrl || thumbnail.imageUrl;
    thumbnail.approvalStatus = processedData.result || thumbnail.approvalStatus;
    thumbnail.approvalStatusReason =
      processedData.reason || thumbnail.approvalStatusReason;

    // Save the updated Thumbnail
    await thumbnail.save();

    return thumbnail;
  } catch (error) {
  
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

async function getThumbnails(req, res) {
  const thumbnails = await Thumbnails.findAll();

  res.status(200).send(thumbnails);
}

async function getThumbnail(thumbnailId) {
  const user = await Thumbnails.findByPk(thumbnailId);
  return user;
}

async function getImageURL(req, res) {
  const bucketName = "joshtalks-ias.appspot.com"; // replace with your bucket name
  const blob = storage.bucket(bucketName).file(req.file.originalname);
  const blobStream = blob.createWriteStream({
    resumable: false,
    gzip: true,
    metadata: {
      cacheControl: "public, max-age=31536000",
    },
  });

  blobStream.on("error", (err) => {
    res.status(500).send(err);
  });

  blobStream.on("finish", async () => {
    await blob.makePublic();
    const url = `https://storage.googleapis.com/${bucketName}/${req.file.originalname}`;

    res.status(200).send(url);
  });

  blobStream.end(req.file.buffer);
}
async function uploadToGCP(blob, buffer) {
  return new Promise((resolve, reject) => {
    const blobStream = blob.createWriteStream({
      resumable: false,
      gzip: true,
      metadata: { cacheControl: "public, max-age=31536000" },
    });

    blobStream.on("error", reject);
    blobStream.on("finish", async () => {
      await blob.makePublic();
      resolve();
    });

    blobStream.end(buffer);
  });
}

//Open AI routes

async function getFileList(req, res) {
  const list = await openai.files.list();
  res.status(200).send({ data: list });
}
async function getList(req, res) {
  const myAssistants = await openai.beta.assistants.list({
    order: "desc",
    limit: "20",
  });

  res.status(200).send({ data: myAssistants });
}

async function deleteAssistant(req, res) {
  const response = await openai.beta.assistants.del(
    "asst_63I5uduVzqEDZJrkvKdmzGdf"
  );

  res.status(200).send({ data: response });
}
async function handleFileCreate() {
  try {
    const file = await openai.files.create({
      file: fs.createReadStream(path.join(__dirname, "thumbnail-rule.pdf")),
      purpose: "assistants",
    });

    return file;
  } catch (error) {
    throw error; // Rethrow the error to propagate it to the calling function
  }
}

async function handleAssistantCreate(req, res) {
  try {
    var myAssistant;
    let fetchedFile = await handleFileCreate();

    if (fetchedFile) {
      try {
        // Your previous code...

        myAssistant = await openai.beta.assistants.create({
          instructions:
            "Josh Talks Thumbnails Checker is dedicated to evaluating YouTube thumbnails for Josh Talks, emphasizing legal, ethical, and content compliance. The role involves scrutinizing thumbnails for potential issues related to nudity, revealing images, ethical violations, and logo misuse. The AI's response format for each thumbnail will be either 'Approved' or 'Rejected'. In cases of approval, no specific reasons will be provided. However, if a thumbnail is rejected, the AI will offer a detailed 'Reason for Rejection', focusing on aspects such as nudity, ethical violations, or logo misuse. Additionally, 'Warnings or Recommendations' will be given, covering guidelines related to logo usage, necessary permissions, and authenticity of the content. The AI requires a transcription of any text in the thumbnail for a thorough review and will withhold judgment until this information is provided. Go through Attached Thumbnail Guidelines pdf file. Image will be provided by the user.",
          name: "joshtalks-test",
          tools: [{ type: "retrieval" }],
          model: "gpt-4-1106-preview",
          file_ids: [fetchedFile.id],
        });

        // Handle the response from myAssistant as needed...
      } catch (error) {
        return res.status(500).send({ error: error.message });
        // Handle the error gracefully, send an appropriate response, or take necessary actions.
        throw error; // Rethrow the error to propagate it to the calling function, if needed.
      }
    } else {
      return res
        .status(500)
        .send({ error: "error occurred on creating assistant" });
    }

    return res.status(200).send({
      assistant: myAssistant,
    });
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
}

async function handleImageCreate(req, res) {
  if (!req.file) {
    return res.status(500).send({ error: error.message });
  }

  try {
    const file = await openai.files.create({
      file: fs.createReadStream(req.file.path),
      purpose: "assistants",
    });

    // Delete the temporary file after use
    fs.unlink(req.file.path, (err) => {
      if (err) console.error("Error deleting temp file:", err);
    });

    return file; // Return the response from OpenAI
  } catch (error) {
    return res.status(500).send({ error: error.message });
  }
}

async function main(req, res) {


    
  const uploadedImage = req.file.path; // The uploaded image buffer
  
  const contentHash = await calculateImageHash(uploadedImage); // Calculate the hash of the image content
 
  // Check if an image with the same content hash already exists in the database
  const existingImage = await findImageByContentHash(contentHash);

  let file = await handleImageCreate(req, res);

  try {
    // Create a thread
    const thread = await openai.beta.threads.create();

    // Use keepAsking as state for keep asking questions
    let keepAsking = true;

    // Pass in the user question into the existing thread

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: "Review this thumbnail for Josh Talks compliance.",
    });

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: "Thumbnail Image File PNG/JPG format",
      file_ids: [file.id],
    });

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Transcription of the text - ${req.body.transcription}`,
    });

    // Use runs to wait for the assistant response and then retrieve it
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: "asst_BPXQbZHMs2eT3haJrAT9KMr8",
    });

    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    // Polling mechanism to see if runStatus is completed
    // This should be made more robust.
    while (runStatus.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Get the last assistant message from the messages array
    const messages = await openai.beta.threads.messages.list(thread.id);

    let processed = null;
    if (messages.data.length == 1) {
      if (response.data.data[0].content[0].text) {
      }
      processed = processInput(messages.data[0].content[0].text.value);
    } else if (messages.data.length == 2) {
      if (response.data.data[0].content[1].text) {
        processed = processInput(messages.data[0].content[1].text.value);
      }
    } else {
      for (let i = 0; i < messages.data.length - 3; i++) {
        let current = messages.data[i].content;

        let track = false;
        for (let k = 0; k < current.length; k++) {
          if (current[k].type === "text") {
            processed = processInput(current[k].text.value);

            track = true;
            break;
          }
        }
        if (track === true) {
          break;
        }
      }
    }
  
    const processedData = {
      ...processed,
      result: processed.result.replace(/'/g, "").toLowerCase(),
    };

   
    var thumbnail;

    if (!existingImage) {
      thumbnail = await insertThumbnail(
        req,
        res,
        file.id,
        processedData,
        contentHash
      );
    } else {
      thumbnail = await updateThumbnailByContentHash(
        req,
        res,
        file.id,
        processedData,
        contentHash
      );
    }
   
    return res
      .status(200)
      .send({ thumbnaildata: thumbnail, data: messages.data });
  } catch (error) {
    return res.status(500).send({ error: error });
  }
}

async function handleReviewThumbnail(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    await main(req, res);
  } catch (error) {
    
    res.status(500).send({ error: error.message });
  }
}

// Synchronize models with the database

module.exports = {
  sequelize,
  handleAssistantCreate,
  getList,
  deleteAssistant,
  handleImageCreate,
  handleReviewThumbnail,
  getFileList,
  insertThumbnail,
  getThumbnail,
  getImageURL,
  getThumbnails,
};
