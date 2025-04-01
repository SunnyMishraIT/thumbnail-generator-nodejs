const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { pipeline } = require('stream');
const streamPipeline = promisify(pipeline);

// Set ffmpeg and ffprobe paths for Lambda layer
let ffmpegPath = '/opt/nodejs/bin/ffmpeg';
let ffprobePath = '/opt/nodejs/bin/ffprobe';

// Determine if we're running in AWS Lambda
const isLambda = process.env.AWS_LAMBDA_FUNCTION_VERSION !== undefined;
const tmpDir = isLambda ? '/tmp' : path.join(__dirname, 'tmp');

// If we're running locally, use local ffmpeg installation from ffmpeg-static
if (!isLambda) {
    try {
        // Try to use ffmpeg-static and ffprobe-static
        const ffmpegStatic = require('ffmpeg-static');
        const ffprobeStatic = require('ffprobe-static').path;
        
        ffmpegPath = ffmpegStatic;
        ffprobePath = ffprobeStatic;
        
        console.log('Running locally, using ffmpeg-static and ffprobe-static');
    } catch (error) {
        console.error('Error setting up ffmpeg/ffprobe-static, falling back to Lambda paths:', error);
    }
}

// Log the paths and check if files exist
console.log('Using ffmpeg paths:', { ffmpegPath, ffprobePath });

// Configure ffmpeg with the correct paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Initialize S3 client
const s3Client = new S3Client({ region: 'ap-south-1' });

// Ensure tmp directory exists
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// Helper function to get video dimensions
async function getVideoDimensions(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.streams[0]);
        });
    });
}

// Helper function to generate thumbnail
async function generateThumbnail(inputPath, outputPath) {
    const stream = await getVideoDimensions(inputPath);
    const { width: originalWidth, height: originalHeight } = stream;
    
    // Calculate dimensions maintaining 9:16 ratio
    let width = 360;
    let height = Math.round((width * 16) / 9);
    
    // Adjust if needed
    const originalRatio = originalHeight / originalWidth;
    const targetRatio = 16 / 9;
    
    if (Math.abs(originalRatio - targetRatio) > 0.1) {
        if (originalRatio > targetRatio) {
            height = Math.round((width * originalHeight) / originalWidth);
        } else {
            width = Math.round((height * originalWidth) / originalHeight);
        }
    }

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .screenshots({
                timestamps: ['00:00:01.000'],
                filename: path.basename(outputPath),
                folder: path.dirname(outputPath),
                size: `${width}x${height}`
            })
            .on('end', resolve)
            .on('error', reject);
    });
}

// Helper function to stream S3 object to file
async function streamS3ToFile(bucket, key, outputPath) {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const writeStream = fs.createWriteStream(outputPath);
    await streamPipeline(response.Body, writeStream);
}

exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event, null, 2));
    
    try {
        // Parse the request body
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        console.log('Parsed body:', JSON.stringify(body, null, 2));

        const { bucket, filepath } = body;
        console.log('Processing video:', { bucket, filepath });

        if (!bucket || !filepath) {
            throw new Error('Missing required parameters: bucket and filepath');
        }

        // Generate temporary file paths
        const tmpVideoPath = path.join(tmpDir, 'input.mp4');
        const tmpThumbnailPath = path.join(tmpDir, 'thumbnail.jpg');

        console.log('Temporary paths:', { tmpVideoPath, tmpThumbnailPath });

        // Download video from S3
        console.log('Downloading video from S3...');
        const getCommand = new GetObjectCommand({
            Bucket: bucket,
            Key: filepath
        });

        const response = await s3Client.send(getCommand);
        console.log('S3 GetObject response received');

        // Save video to temporary file
        await new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(tmpVideoPath);
            response.Body.pipe(writeStream)
                .on('error', (err) => {
                    console.error('Error writing video file:', err);
                    reject(err);
                })
                .on('finish', () => {
                    console.log('Video file written successfully');
                    resolve();
                });
        });

        // Generate thumbnail
        console.log('Generating thumbnail...');
        await new Promise((resolve, reject) => {
            ffmpeg(tmpVideoPath)
                .screenshots({
                    timestamps: ['50%'],
                    filename: 'thumbnail.jpg',
                    folder: tmpDir,
                    size: '360x640'
                })
                .on('end', () => {
                    console.log('Thumbnail generation completed');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('Error generating thumbnail:', err);
                    reject(err);
                });
        });

        // Upload thumbnail to S3
        console.log('Uploading thumbnail to S3...');
        const thumbnailKey = filepath.replace(/\.[^/.]+$/, '_thumbnail.jpg');
        const fileStream = fs.createReadStream(tmpThumbnailPath);
        
        const uploadCommand = new PutObjectCommand({
            Bucket: bucket,
            Key: thumbnailKey,
            Body: fileStream,
            ContentType: 'image/jpeg'
        });

        await s3Client.send(uploadCommand);
        console.log('Thumbnail uploaded successfully');

        // Clean up temporary files
        console.log('Cleaning up temporary files...');
        fs.unlinkSync(tmpVideoPath);
        fs.unlinkSync(tmpThumbnailPath);
        console.log('Cleanup completed');

        // Return success response
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                message: 'Thumbnail generated successfully',
                thumbnailPath: thumbnailKey
            })
        };

    } catch (error) {
        console.error('Error in Lambda function:', error);
        
        // Clean up temporary files if they exist
        try {
            const tmpVideoPath = path.join(tmpDir, 'input.mp4');
            const tmpThumbnailPath = path.join(tmpDir, 'thumbnail.jpg');
            
            if (fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);
            if (fs.existsSync(tmpThumbnailPath)) fs.unlinkSync(tmpThumbnailPath);
        } catch (cleanupError) {
            console.error('Error during cleanup:', cleanupError);
        }

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                message: 'Error generating thumbnail',
                error: error.message,
                stack: error.stack
            })
        };
    }
}; 