const express = require('express');
const Stripe = require('stripe');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /api/stripe/create-checkout — create a Stripe checkout session
router.post('/create-checkout', authenticate, async (req, res) => {
  const userId = req.user.id;
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  try {
    // Check if user already has a stripe_customer_id
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id=$1',
      [userId]
    );
    const user = userResult.rows[0];

    let customerId = user.stripe_customer_id;

    // Create a Stripe customer if they don't have one
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { user_id: userId.toString() },
      });
      customerId = customer.id;
      await pool.query(
        'UPDATE users SET stripe_customer_id=$1 WHERE id=$2',
        [customerId, userId]
      );
    }

    // Create checkout session
    console.log('Creating checkout with baseUrl:', baseUrl);
    console.log('Price ID:', process.env.STRIPE_PRICE_ID);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${baseUrl}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/upgrade?cancelled=true`,
      metadata: { user_id: userId.toString() },
    });

    console.log('Checkout session created:', session.id);

    res.json({ url: session.url });
  } catch (err) {
    console.log('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stripe/create-portal — customer billing portal to manage subscription
router.post('/create-portal', authenticate, async (req, res) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  try {
    const userResult = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE id=$1',
      [req.user.id]
    );
    const customerId = userResult.rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No subscription found' });

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/upgrade`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.log('Stripe portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stripe/webhook — handle Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // Payment successful — upgrade user to premium
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        if (userId) {
          await pool.query(
            'UPDATE users SET is_premium=true, premium_since=NOW() WHERE id=$1',
            [userId]
          );
          // Store subscription id
          if (session.subscription) {
            await pool.query(
              'UPDATE users SET stripe_subscription_id=$1 WHERE id=$2',
              [session.subscription, userId]
            );
          }
          console.log(`User ${userId} upgraded to premium`);
        }
        break;
      }

      // Subscription renewed — keep premium active
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        if (customerId) {
          await pool.query(
            'UPDATE users SET is_premium=true WHERE stripe_customer_id=$1',
            [customerId]
          );
        }
        break;
      }

      // Payment failed — notify but keep premium for now
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log('Payment failed for customer:', invoice.customer);
        break;
      }

      // Subscription cancelled — remove premium
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        await pool.query(
          'UPDATE users SET is_premium=false, premium_since=NULL WHERE stripe_customer_id=$1',
          [customerId]
        );
        console.log('Premium removed for customer:', customerId);
        break;
      }
    }
  } catch (err) {
    console.log('Webhook handler error:', err.message);
  }

  res.json({ received: true });
});

module.exports = router;