-- Project Capture keeps handwritten note photos private in Marvin's source bucket.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'image/jpeg',
  'image/png',
  'image/webp'
]
WHERE id = 'marvin-sources';
