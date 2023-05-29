const jsdom = require('jsdom');
const { Readability } = require('@mozilla/readability');
const DOMPurify = require('dompurify');
const { exec } = require('child_process');
const path = require('path');
const { createReadStream, readdirSync, unlinkSync } = require('fs');

// Use dynamic import for node-fetch
// Use dynamic import for node-fetch
const fetchPromise = import('node-fetch');
const fetch = async (url) => {
  const module = await fetchPromise;
  return module.default(url);
};

const fs = require('fs/promises');

const addon = require('./addon.node');

async function fetchHtml(url) {
  const response = await fetch(url);
  const html = await response.text();
  const dom = new jsdom.JSDOM(html);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  return article.textContent;
}

async function generateAudio(textContent, config) {
  let runConfig = {
    modelPath: config.modelPath,
    modelConfigPath: config.modelConfigPath,
    outputType: config.outputType,
    outputPath: config.outputPath,
  };

  return new Promise((resolve, reject) => {
    try {
      addon.textToSpeech(textContent, runConfig);
      resolve(true);
    } catch (error) {
      reject(error);
    }
  });
}

async function generateAudioForParagraphs(textContent, config) {
  const normalizedText = textContent.trim().replace(/[^\x00-\x7F]/g, '');
  const paragraphs = normalizedText.split('\n\n');
  for (let index = 0; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index];
    if (!paragraph.trim()) {
      continue;
    }
    const outputFile = `${config.outputDir}/paragraph_${index}.wav`;
    const runConfig = {
      modelPath: path.resolve('en-us-ryan-high.onnx'),
      modelConfigPath: path.resolve('en-us-ryan-high.onnx.json'),
      outputType: addon.OUTPUT_FILE,
      outputPath: path.resolve(outputFile),
    };
    console.log(`Generating audio for paragraph ${index} with length ${paragraph.length}`);
    try {
      await Promise.race([
        generateAudio(paragraph, runConfig),
        new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Audio generation timed out')), config.timeout);
        }),
      ]);
      console.log(`Audio generated for paragraph ${index}`);
    } catch (error) {
      console.error(`Error generating audio for paragraph ${index}: ${error}`);
    }
  }
  console.log('All paragraphs processed');
}
const wav = require('wav');
const async = require('async');

async function combineWavFiles(inputDir, outputFile) {
  console.log(`Combining WAV files in ${inputDir} into ${outputFile}...`);
  const files = readdirSync(inputDir).filter(file => path.extname(file) === '.wav');
  if (files.length === 0) {
    throw new Error('No WAV files found in input directory');
  }
  const firstFile = files[0];
  const reader = new wav.Reader();
  const fileStream = createReadStream(path.join(inputDir, firstFile));
  fileStream.pipe(reader);
  const formatPromise = new Promise((resolve, reject) => {
    reader.on('format', format => {
      resolve(format);
    });
    reader.on('error', error => {
      reject(error);
    });
  });
  const format = await formatPromise;
  const writer = new wav.FileWriter(outputFile, format);
  writer.setMaxListeners(100);
  const writeNextFile = (file, callback) => {
    const reader = new wav.Reader();
    const fileStream = createReadStream(path.join(inputDir, file));
    fileStream.pipe(reader);
    reader.on('data', data => {
      const canWriteMore = writer.write(data);
      if (!canWriteMore) {
        reader.pause();
        writer.once('drain', () => {
          reader.resume();
        });
      }
    });
    reader.on('end', () => {
      callback();
    });
    reader.on('error', error => {
      console.error(`Error reading input file: ${error}`);
      writer.emit('error', error);
    });
  };
  return new Promise((resolve, reject) => {
    async.eachSeries(files.slice(1), writeNextFile, error => {
      if (error) {
        console.error(`Error writing to output file: ${error}`);
        reject(error);
      } else {
        writer.end();
        console.log('Files combined successfully');
        resolve();
      }
    });
  });
}

async function copyWavFile(inputFile, outputFile) {
  console.log(`Copying WAV file ${inputFile} to ${outputFile}...`);
  const reader = new wav.Reader();
  const fileStream = createReadStream(inputFile);
  fileStream.pipe(reader);
  const formatPromise = new Promise((resolve, reject) => {
    reader.on('format', format => {
      resolve(format);
    });
    reader.on('error', error => {
      reject(error);
    });
  });

  const format = await formatPromise;
  const writer = new wav.FileWriter(outputFile, format);
  reader.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      console.log('File copied successfully');
      resolve();
    });
    writer.on('error', error => {
      reject(error);
    });
  });
}

const ffmpeg = require('fluent-ffmpeg');

async function convertWavToMp3(inputFile, outputFile) {
  console.log(`Converting ${inputFile} to ${outputFile}...`);
  return new Promise((resolve, reject) => {
    ffmpeg(inputFile)
      .output(outputFile)
      .on('end', () => {
        console.log('File converted successfully');
        resolve();
      })
      .on('error', error => {
        console.error(`Error converting file: ${error}`);
        reject(error);
      })
      .run();
  });
}

async function main() {
  const config = { outputDir: 'output', timeout: 10000, url: 'https://stratechery.com/2023/windows-and-the-ai-platform-shift/' };
  const text = await fetchHtml(config.url);
  console.log(text);
  await generateAudioForParagraphs(text, config);

  try {
    await combineWavFiles(config.outputDir, 'output.wav');
    const mp3File = 'output.mp3';
    await convertWavToMp3('output.wav', mp3File);
  } catch (e) {
    console.error(e);
  }
}

main().catch(console.error);