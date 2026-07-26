const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// Default checklist tasks every student gets
const DEFAULT_TASKS = [
  // Before you arrive
  { key: 'passport', category: 'Before You Arrive', title: 'Check your passport & visa', desc: 'Make sure your passport is valid for your full stay and your student visa (BRP or e-visa) is in order.', icon: '🛂', link: null },
  { key: 'flight', category: 'Before You Arrive', title: 'Book your flight & airport transfer', desc: 'Book your flight and arrange how you will get from the airport to your accommodation.', icon: '✈️', link: 'https://www.uber.com/gb' },
  { key: 'accommodation_confirm', category: 'Before You Arrive', title: 'Confirm your accommodation', desc: 'Contact your landlord or university halls to confirm your move-in date and get the address.', icon: '🏡', link: null },
  { key: 'travel_insurance', category: 'Before You Arrive', title: 'Get travel insurance', desc: 'Arrange travel and contents insurance before you leave home.', icon: '🛡️', link: null },
  { key: 'gbp_cash', category: 'Before You Arrive', title: 'Get some GBP cash', desc: 'Bring enough British pounds to cover your first few days before your bank account is set up.', icon: '💷', link: null },

  // First 48 hours
  { key: 'brp_collect', category: 'First 48 Hours', title: 'Collect your BRP card', desc: 'If your visa letter says to collect a BRP, pick it up from the specified Post Office within 10 days of arriving.', icon: '🪪', link: 'https://www.gov.uk/biometric-residence-permits' },
  { key: 'sim_card', category: 'First 48 Hours', title: 'Get a UK SIM card', desc: 'Get a UK number so you can stay connected. Giffgaff, Lebara and Lyca are popular affordable options for international students.', icon: '📱', link: 'https://www.giffgaff.com' },
  { key: 'university_register', category: 'First 48 Hours', title: 'Register at your university', desc: 'Complete your university enrolment, get your student ID card and set up your university email.', icon: '🎓', link: null },
  { key: 'local_area', category: 'First 48 Hours', title: 'Explore your local area', desc: 'Find your nearest supermarket, pharmacy, GP surgery and transport links.', icon: '🗺️', link: null },

  // First week
  { key: 'bank_account', category: 'First Week', title: 'Open a UK bank account', desc: 'Open a student bank account. Monzo, Starling or Wise are easy to set up without a UK address history. Traditional banks like Barclays and HSBC also offer student accounts.', icon: '🏦', link: 'https://www.monzo.com' },
  { key: 'nhs_register', category: 'First Week', title: 'Register with a GP (doctor)', desc: 'Find and register with your nearest NHS GP surgery. As a student who paid the Immigration Health Surcharge, NHS care is free for you.', icon: '🏥', link: 'https://www.nhs.uk/service-search/find-a-gp' },
  { key: 'ni_number', category: 'First Week', title: 'Apply for a National Insurance number', desc: 'You need an NI number to work in the UK. Apply online through the government website.', icon: '🔢', link: 'https://www.gov.uk/apply-national-insurance-number' },
  { key: 'transport_card', category: 'First Week', title: 'Set up transport payment', desc: 'Get an Oyster card (London) or set up contactless payments for local buses and trains. Consider a 16-25 Railcard to save a third on train fares.', icon: '🚌', link: 'https://www.16-25railcard.co.uk' },
  { key: 'buddy_match', category: 'First Week', title: 'Find your Settle-In Buddy', desc: 'Connect with a buddy who speaks your language and can guide you through UK student life.', icon: '🤝', link: '/buddy' },

  // First month
  { key: 'council_tax', category: 'First Month', title: 'Apply for council tax exemption', desc: 'Full-time students are exempt from council tax. Get a certificate from your university and send it to your local council.', icon: '🏛️', link: null },
  { key: 'railcard', category: 'First Month', title: 'Get a 16-25 Railcard', desc: 'Save a third on all rail travel across the UK. Costs £30/year and pays for itself quickly.', icon: '🎫', link: 'https://www.16-25railcard.co.uk' },
  { key: 'student_discount', category: 'First Month', title: 'Set up student discounts', desc: 'Register for UNiDAYS and Student Beans to access hundreds of student discounts on food, tech, fashion and more.', icon: '💳', link: 'https://www.unidays.com' },
  { key: 'part_time_work', category: 'First Month', title: 'Understand your work rights', desc: 'Student visa holders can usually work up to 20 hours per week during term time and full time during holidays. Check your visa conditions.', icon: '💼', link: 'https://www.gov.uk/student-visa/work' },
  { key: 'mental_health', category: 'First Month', title: 'Know your mental health support', desc: 'Moving abroad is tough. Find your university\'s counselling service and save the Samaritans number (116 123) just in case.', icon: '💚', link: 'https://www.samaritans.org' },
  { key: 'home_contact', category: 'First Month', title: 'Set up regular contact with home', desc: 'Schedule regular calls with family and friends back home. WhatsApp, Zoom and Google Meet are free.', icon: '📞', link: null },
];

// GET /api/checklist — get student's checklist with completion status
router.get('/', authenticate, requireRole('student'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT task_key, completed, completed_at FROM checklist_items WHERE user_id=$1',
      [req.user.id]
    );
    const completedMap = {};
    result.rows.forEach(r => { completedMap[r.task_key] = { completed: r.completed, completed_at: r.completed_at }; });

    const tasks = DEFAULT_TASKS.map(task => ({
      ...task,
      completed: completedMap[task.key]?.completed || false,
      completed_at: completedMap[task.key]?.completed_at || null,
    }));

    res.json(tasks);
  } catch (err) {
    console.log('Checklist error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/checklist/:key — toggle a task
router.patch('/:key', authenticate, requireRole('student'), async (req, res) => {
  const { completed } = req.body;
  try {
    await pool.query(
      `INSERT INTO checklist_items (user_id, task_key, completed, completed_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, task_key)
       DO UPDATE SET completed=$3, completed_at=$4`,
      [req.user.id, req.params.key, completed, completed ? new Date() : null]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.log('Checklist update error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;