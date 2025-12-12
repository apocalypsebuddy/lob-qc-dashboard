# AWS S3 Setup Plan

## Overview
This guide will help you set up an S3 bucket for storing PDF and JPG files uploaded when creating seeds. Files will be publicly accessible via URLs that are stored in the database.

## Step-by-Step Setup Instructions

### 1. Create S3 Bucket

1. **Log into AWS Console**
   - Go to https://console.aws.amazon.com/
   - Navigate to **S3** service

2. **Create Bucket**
   - Click **"Create bucket"**
   - **Bucket name**: Choose a unique name (e.g., `hackathon-pudding-seeds` or `your-company-seeds`)
     - ⚠️ Bucket names must be globally unique across all AWS accounts
     - Use lowercase letters, numbers, and hyphens only
   - **AWS Region**: Choose your preferred region (e.g., `us-east-1`, `us-west-2`)
     - ⚠️ **IMPORTANT**: Note this region - you'll need it for `AWS_REGION` env variable
   - **Object Ownership**: 
     - Select **"ACLs disabled (recommended)"** OR **"ACLs enabled"**
     - ⚠️ **NOTE**: If you choose "ACLs disabled", you'll need to use a bucket policy (see Step 3)
   - **Block Public Access settings**: 
     - ⚠️ **IMPORTANT**: Since files need to be publicly accessible, you'll need to:
       - Uncheck **"Block all public access"** OR
       - Configure a bucket policy to allow public reads (see Step 3)
   - **Bucket Versioning**: Optional (can leave disabled)
   - **Default encryption**: Recommended to enable (SSE-S3 is fine)
   - Click **"Create bucket"**

### 2. Configure Bucket Policy (for Public Access)

Since the code uses `ACL: 'public-read'`, you have two options:

#### Option A: Enable ACLs and Use ACL-based Access
1. Go to your bucket → **Permissions** tab
2. Under **"Object Ownership"**, click **Edit**
3. Select **"ACLs enabled"** and **"Bucket owner preferred"**
4. Save changes
5. Under **"Block public access"**, click **Edit**
6. Uncheck **"Block all public access"** (or at least uncheck "Block public access to buckets and objects granted through new access control lists (ACLs)")
7. Save changes

#### Option B: Disable ACLs and Use Bucket Policy (Recommended)
1. Go to your bucket → **Permissions** tab
2. Under **"Block public access"**, click **Edit**
3. Uncheck **"Block all public access"**
4. Save changes
5. Scroll to **"Bucket policy"** and click **Edit**
6. Paste the following policy (replace `YOUR-BUCKET-NAME` with your actual bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

7. Click **Save changes**

⚠️ **IMPORTANT**: If you use Option B (bucket policy), you'll need to update the code to remove the `ACL: 'public-read'` parameter from the `PutObjectCommand`. See "Code Updates Needed" section below.

### 3. Get Access Keys from Existing IAM User

**Option A: Using Existing IAM User with S3 Full Access** ✅ (Simplest)

If you already have an IAM user with S3 Full Access:

1. **Navigate to IAM**
   - Go to **IAM** service in AWS Console
   - Click **Users** in the left sidebar
   - Find your existing user with S3 Full Access

2. **Get Access Keys**
   - Click on the user
   - Go to **"Security credentials"** tab
   - Scroll to **"Access keys"** section
   - **If you already have access keys**: Copy them (you may need to reveal the secret key)
   - **If you need to create new access keys**:
     - Click **"Create access key"**
     - Select **"Application running outside AWS"**
     - Click **"Next"**
     - Add description (optional): "Seeds Dashboard S3 Upload"
     - Click **"Create access key"**
     - ⚠️ **IMPORTANT**: Copy both:
       - **Access key ID** (starts with `AKIA...`)
       - **Secret access key** (click "Show" to reveal)
     - ⚠️ **WARNING**: The secret key is only shown once! Save it securely.
     - Click **"Done"**

**Option B: Create New IAM User with Minimal Permissions** (More Secure)

If you prefer to create a new user with minimal permissions:

1. **Navigate to IAM**
   - Go to **IAM** service in AWS Console
   - Click **Users** in the left sidebar
   - Click **"Create user"**

2. **Set User Details**
   - **User name**: `s3-seeds-uploader` (or your preferred name)
   - Click **"Next"**

3. **Set Permissions**
   - Select **"Attach policies directly"**
   - Click **"Create policy"** (opens in new tab)
   - Switch to **JSON** tab
   - Paste this policy (replace `YOUR-BUCKET-NAME` with your bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME"
    }
  ]
}
```

   - Click **"Next"**
   - **Policy name**: `S3SeedsUploadPolicy`
   - Click **"Create policy"**
   - Go back to the user creation tab and refresh
   - Select the policy you just created
   - Click **"Next"**
   - Click **"Create user"**

4. **Create Access Keys** (same as Option A step 2)

### 4. Configure Environment Variables

Add these to your `.env` file:

```bash
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your-access-key-id-here
AWS_SECRET_ACCESS_KEY=your-secret-access-key-here
AWS_S3_BUCKET=your-bucket-name-here
AWS_REGION=us-east-1  # or whatever region you chose
```

⚠️ **Security Note**: Never commit `.env` file to git (it's already in `.gitignore`)

### 5. Test the Setup

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Create a new seed and upload a test file (PDF or JPG)

3. Check the logs for any S3-related errors

4. Verify the file appears in your S3 bucket:
   - Go to S3 → Your bucket
   - You should see files organized by user ID: `{userId}/{timestamp}-{random}.{ext}`

5. Test the public URL:
   - Click on a file in S3
   - Copy the object URL
   - Open it in a browser - it should display/download the file

## Code Updates Needed

### Issue: ACL Deprecation

The current code uses `ACL: 'public-read'` which may not work if:
- Your bucket has ACLs disabled (newer default)
- You're using a bucket policy instead

**If you chose Option B (Bucket Policy) above**, update `app/services/s3_service.ts`:

**Current code (line 66):**
```typescript
const command = new PutObjectCommand({
  Bucket: bucket,
  Key: uniqueFileName,
  Body: fileContent,
  ContentType: contentType,
  ACL: 'public-read', // Make file publicly accessible
})
```

**Updated code:**
```typescript
const command = new PutObjectCommand({
  Bucket: bucket,
  Key: uniqueFileName,
  Body: fileContent,
  ContentType: contentType,
  // ACL removed - using bucket policy instead
})
```

## Troubleshooting

### Error: "Access Denied"
- Check that your IAM user has the correct permissions
- Verify the bucket policy allows public reads
- Ensure Block Public Access is disabled

### Error: "InvalidAccessKeyId"
- Double-check your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env`
- Ensure there are no extra spaces or quotes

### Error: "NoSuchBucket"
- Verify `AWS_S3_BUCKET` matches your bucket name exactly
- Check `AWS_REGION` matches the bucket's region

### Files not publicly accessible
- If using ACLs: Ensure ACLs are enabled on the bucket
- If using bucket policy: Verify the policy is correctly configured
- Check that Block Public Access is disabled

### URL format issues
- The code constructs URLs as: `https://{bucket}.s3.{region}.amazonaws.com/{key}`
- For some regions (e.g., `us-east-1`), the URL format might be: `https://{bucket}.s3.amazonaws.com/{key}`
- If URLs don't work, you may need to update the URL construction in `s3_service.ts` line 82

## Security Considerations

1. **Public Access**: Files are publicly accessible via URL. Anyone with the URL can access the file.
2. **File Organization**: Files are organized by user ID, but URLs contain random components
3. **Cost**: Monitor S3 storage and data transfer costs
4. **IAM User**: Use least-privilege access (only `PutObject` permission)
5. **Encryption**: Consider enabling bucket encryption for additional security

## Next Steps

1. ✅ Complete S3 bucket setup
2. ✅ Create IAM user and access keys
3. ✅ Add environment variables to `.env`
4. ⚠️ Update code if using bucket policy (remove ACL)
5. ✅ Run migration: `node ace migration:run`
6. ✅ Test file upload functionality
