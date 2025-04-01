# Video Thumbnail Generator Lambda Function

This AWS Lambda function automatically generates thumbnails from videos uploaded to S3. When a video is uploaded to the configured S3 bucket, this function creates a thumbnail and saves it in the same location with a '_thumbnail.jpg' suffix.

## Features

- Automatically generates thumbnails for uploaded videos
- Supports common video formats (mp4, avi, mov, wmv, flv, mkv)
- Creates thumbnails at the 1-second mark of the video
- Saves thumbnails in the same S3 path as the source video
- Thumbnail size: 320x240 pixels

## Setup Instructions

1. Create a new Lambda function in AWS:
   - Runtime: Node.js 18.x
   - Architecture: x86_64
   - Memory: At least 512 MB
   - Timeout: At least 30 seconds

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a ZIP file with the following:
   - index.js
   - node_modules/
   - package.json

4. Upload the ZIP file to your Lambda function

5. Configure the Lambda function:
   - Add S3 trigger for your bucket
   - Grant necessary IAM permissions:
     ```json
     {
         "Version": "2012-10-17",
         "Statement": [
             {
                 "Effect": "Allow",
                 "Action": [
                     "s3:GetObject",
                     "s3:PutObject"
                 ],
                 "Resource": [
                     "arn:aws:s3:::your-bucket-name/*"
                 ]
             }
         ]
     }
     ```

## Usage

1. Upload a video file to the configured S3 bucket
2. The Lambda function will automatically trigger
3. A thumbnail will be generated and saved in the same location with '_thumbnail.jpg' suffix

## Supported Video Formats

- MP4
- AVI
- MOV
- WMV
- FLV
- MKV

## Error Handling

The function includes error handling for:
- Invalid file types
- Failed video processing
- S3 access issues
- File system operations

Errors are logged to CloudWatch Logs for monitoring and debugging. 