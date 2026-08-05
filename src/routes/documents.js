const express = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP and PDF files are allowed'));
  },
});

const SYSTEM_PROMPT = `You are a helpful document assistant for international students in the UK.
You help students understand their immigration and study documents.

When given extracted text from a document:
1. Identify what type of document it is
2. Extract and clearly present the key information
3. Highlight any important dates (expiry dates, visa validity, enrolment dates)
4. Flag anything the student should be aware of or act on
5. Answer any questions the student has about the document

Document types you can help with:
- UK Student Visa / BRP (Biometric Residence Permit)
- Passport
- CAS (Confirmation of Acceptance for Studies)
- University offer letter
- Tenancy agreement
- Employment contract
- NHS registration letter
- National Insurance number letter
- Bank statements
- Council tax exemption letter

Important rules:
- For complex legal matters always recommend consulting a regulated adviser
- Be clear about expiry dates and deadlines
- Use simple clear language
- Format key information in easy-to-read bullet points
- If the text is unclear or incomplete say so

You are NOT a lawyer or immigration adviser. You provide helpful general guidance only.`;

router.post('/analyse', authenticate, requireRole('student'), upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No document uploaded' });

  const { question } = req.body;

  try {
    let extractedText = '';

    // Extract text from the document using OCR.space free API
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    formData.append('apikey', 'helloworld'); // free tier key
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2');

    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });

    const ocrData = await ocrResponse.json();

    if (ocrData.IsErroredOnProcessing) {
      console.log('OCR error:', ocrData.ErrorMessage);
      return res.status(500).json({ error: 'Could not read the document. Please make sure the image is clear and well-lit.' });
    }

    extractedText = ocrData.ParsedResults?.[0]?.ParsedText || '';

    if (!extractedText.trim()) {
      return res.status(400).json({ error: 'Could not extract any text from this document. Please make sure the document is clear and readable.' });
    }

    console.log('Extracted text length:', extractedText.length);

    // Now send to Groq for analysis
    const prompt = question
      ? `Here is the text extracted from a student document:\n\n${extractedText}\n\nPlease answer this specific question: ${question}`
      : `Here is the text extracted from a student document:\n\n${extractedText}\n\nPlease analyse this document. Identify what it is, extract the key information, highlight important dates and flag anything the student should be aware of.`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const groqData = await groqResponse.json();

    if (!groqResponse.ok) {
      console.log('Groq error:', JSON.stringify(groqData));
      return res.status(500).json({ error: groqData.error?.message || 'AI service error' });
    }

    res.json({
      analysis: groqData.choices[0].message.content,
      extractedText: extractedText.slice(0, 500) + (extractedText.length > 500 ? '...' : ''),
    });

  } catch (err) {
    console.log('Document analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;