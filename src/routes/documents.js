const express = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
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
    console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);

    // Convert to base64
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Build OCR.space request using base64
    const ocrApiKey = process.env.OCR_API_KEY || 'helloworld';

    const ocrFormData = new URLSearchParams();
    ocrFormData.append('apikey', ocrApiKey);
    ocrFormData.append('language', 'eng');
    ocrFormData.append('isOverlayRequired', 'false');
    ocrFormData.append('detectOrientation', 'true');
    ocrFormData.append('scale', 'true');
    ocrFormData.append('OCREngine', '2');
    ocrFormData.append('base64Image', `data:${mimeType};base64,${base64Image}`);

    console.log('Sending to OCR.space...');

    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: ocrFormData.toString(),
    });

    console.log('OCR response status:', ocrResponse.status);
    const ocrData = await ocrResponse.json();
    console.log('OCR result:', JSON.stringify(ocrData).slice(0, 300));

    if (ocrData.IsErroredOnProcessing) {
      console.log('OCR error:', ocrData.ErrorMessage);
      // Try fallback with OCREngine 1
      console.log('Trying OCR Engine 1 fallback...');
      const fallbackForm = new URLSearchParams();
      fallbackForm.append('apikey', ocrApiKey);
      fallbackForm.append('language', 'eng');
      fallbackForm.append('isOverlayRequired', 'false');
      fallbackForm.append('OCREngine', '1');
      fallbackForm.append('base64Image', `data:${mimeType};base64,${base64Image}`);

      const fallbackRes = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fallbackForm.toString(),
      });
      const fallbackData = await fallbackRes.json();
      console.log('Fallback OCR result:', JSON.stringify(fallbackData).slice(0, 300));

      if (fallbackData.IsErroredOnProcessing || !fallbackData.ParsedResults?.[0]?.ParsedText?.trim()) {
        return res.status(400).json({
          error: 'Could not extract text from this document. Please ensure the image is clear, well-lit and not blurry. Try a higher quality photo or scan.',
        });
      }
      ocrData.ParsedResults = fallbackData.ParsedResults;
    }

    const extractedText = ocrData.ParsedResults?.[0]?.ParsedText?.trim() || '';
    console.log('Extracted text length:', extractedText.length);
    console.log('Extracted text preview:', extractedText.slice(0, 200));

    if (!extractedText) {
      return res.status(400).json({
        error: 'No text found in this document. Please ensure the document contains readable text and is not a blank or decorative image.',
      });
    }

    // Send to Groq for analysis
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
        model: 'openai/gpt-oss-120b',
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
    console.log('Full error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;