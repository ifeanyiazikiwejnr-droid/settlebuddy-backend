const express = require('express');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

const SYSTEM_PROMPT = `You are SettleIn Assistant, a friendly and knowledgeable AI helper for international students arriving in the UK. You are part of the Settle-In Buddy platform.

You help students with:
- UK Student visa rules and conditions (working hours, travel, extensions)
- BRP (Biometric Residence Permit) and e-visa queries
- NHS registration and healthcare
- Opening UK bank accounts
- National Insurance numbers
- Council tax exemption for students
- Part-time work rules (20 hours during term time, full time in holidays)
- Graduate visa and post-study work options
- UK transport and getting around
- Accommodation rights and tenancy
- Cultural adaptation and student life in the UK
- University enrollment and CAS (Confirmation of Acceptance for Studies)

Important rules:
- Always be warm, friendly and encouraging
- Give practical, specific advice
- For complex immigration or legal matters, always recommend speaking to the university's international student office or a regulated immigration adviser (OISC)
- Never give definitive legal advice — signpost to official sources like gov.uk
- Keep answers concise and easy to read
- Use bullet points for lists
- If asked about something unrelated to UK student life or settlement, politely redirect back to your area of expertise
- Always mention if information may change and suggest checking gov.uk for the latest

You are NOT a lawyer or immigration adviser. You provide helpful general guidance only.`;

router.post('/chat', authenticate, async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array required' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages.slice(-10),
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.log('Groq error:', JSON.stringify(data));
      return res.status(500).json({ error: data.error?.message || 'AI service error' });
    }

    res.json({ reply: data.choices[0].message.content });
  } catch (err) {
    console.log('AI chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;