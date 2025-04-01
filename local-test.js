const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { pipeline } = require('stream');
const streamPipeline = promisify(pipeline);
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

// Create test directory if it doesn't exist
const testDir = path.join(__dirname, 'test');
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
}

// Create tmp directory if it doesn't exist
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// Mock the S3 client
const originalS3Send = S3Client.prototype.send;
S3Client.prototype.send = async function(command) {
    console.log(`Mocking S3 command: ${command.constructor.name}`);
    
    if (command.constructor.name === 'GetObjectCommand') {
        console.log(`Mock GetObject for bucket: ${command.input.Bucket}, key: ${command.input.Key}`);
        
        // For GetObject, return a stream of the local file
        const filePath = path.join(__dirname, command.input.Key);
        console.log(`Reading from local file: ${filePath}`);
        
        return {
            Body: fs.createReadStream(filePath)
        };
    } 
    else if (command.constructor.name === 'PutObjectCommand') {
        console.log(`Mock PutObject for bucket: ${command.input.Bucket}, key: ${command.input.Key}`);
        
        // For PutObject, save to local file
        const filePath = path.join(__dirname, command.input.Key);
        console.log(`Writing to local file: ${filePath}`);
        
        // Create directory if it doesn't exist
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        
        const writeStream = fs.createWriteStream(filePath);
        await streamPipeline(command.input.Body, writeStream);
        console.log(`Successfully wrote to ${filePath}`);
        
        return {};
    }
    
    // Fallback to original behavior
    return originalS3Send.call(this, command);
};

// Import after mock is set up
const { handler } = require('./index');

console.log('Please place a test video in your test directory named "test-video.mp4"');
console.log(`Looking for video at: ${path.join(testDir, 'test-video.mp4')}`);

// Check if test video exists
if (!fs.existsSync(path.join(testDir, 'test-video.mp4'))) {
    console.error('Error: test video not found');
    console.error('Please place a test video file named "test-video.mp4" in the test directory.');
    process.exit(1);
}

// Create mock Lambda event
const mockEvent = {
    body: JSON.stringify({
        bucket: 'test-bucket',
        filepath: 'test/test-video.mp4'
    })
};

console.log('Starting local test...');
handler(mockEvent)
    .then(result => {
        console.log('Test completed successfully!');
        console.log('Result:', JSON.stringify(result, null, 2));
        
        // Check if thumbnail was created
        const thumbnailPath = path.join(__dirname, 'test/test-video_thumbnail.jpg');
        if (fs.existsSync(thumbnailPath)) {
            console.log(`Thumbnail created successfully at: ${thumbnailPath}`);
        } else {
            console.log('Thumbnail was not created at the expected location');
        }
    })
    .catch(error => {
        console.error('Error during test:', error);
    }); 