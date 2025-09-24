#!/usr/bin/env node

/**
 * Keephy Plans Service
 * Manages subscription plans and pricing
 */

import express from 'express';
import mongoose from 'mongoose';
import pino from 'pino';
import pinoHttp from 'pino-http';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
const PORT = process.env.PORT || 3019;

// Middleware
app.use(helmet());
app.use(cors());
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '10mb' }));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/keephy_enhanced';

mongoose.connect(MONGODB_URI)
  .then(() => logger.info('Connected to MongoDB'))
  .catch(err => logger.error('MongoDB connection error:', err));

// Plan Schema
const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  interval: { 
    type: String, 
    enum: ['monthly', 'yearly', 'lifetime'],
    default: 'monthly'
  },
  features: [{
    name: String,
    included: Boolean,
    limit: Number,
    description: String
  }],
  limits: {
    franchises: { type: Number, default: 1 },
    forms: { type: Number, default: 5 },
    submissions: { type: Number, default: 100 },
    staff: { type: Number, default: 5 },
    storage: { type: Number, default: 1024 }, // MB
    apiCalls: { type: Number, default: 1000 }
  },
  stripePriceId: String,
  stripeProductId: String,
  isActive: { type: Boolean, default: true },
  isPopular: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Plan = mongoose.model('Plan', planSchema);

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'keephy_plans',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/ready', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ready', service: 'keephy_plans' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});

// Get all active plans
app.get('/api/plans', async (req, res) => {
  try {
    const { active, popular } = req.query;
    
    let filter = {};
    if (active === 'true') filter.isActive = true;
    if (popular === 'true') filter.isPopular = true;
    
    const plans = await Plan.find(filter)
      .sort({ sortOrder: 1, price: 1 });
    
    res.json({
      success: true,
      data: plans,
      count: plans.length
    });
  } catch (error) {
    logger.error('Error fetching plans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch plans'
    });
  }
});

// Get plan by ID
app.get('/api/plans/:id', async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found'
      });
    }
    
    res.json({
      success: true,
      data: plan
    });
  } catch (error) {
    logger.error('Error fetching plan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch plan'
    });
  }
});

// Create plan
app.post('/api/plans', async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      currency,
      interval,
      features,
      limits,
      stripePriceId,
      stripeProductId,
      isPopular,
      sortOrder
    } = req.body;
    
    if (!name || price === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Plan name and price are required'
      });
    }
    
    const plan = new Plan({
      name,
      description,
      price,
      currency: currency || 'USD',
      interval: interval || 'monthly',
      features: features || [],
      limits: limits || {},
      stripePriceId,
      stripeProductId,
      isPopular: isPopular || false,
      sortOrder: sortOrder || 0
    });
    
    await plan.save();
    
    res.status(201).json({
      success: true,
      data: plan
    });
  } catch (error) {
    logger.error('Error creating plan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create plan'
    });
  }
});

// Update plan
app.put('/api/plans/:id', async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      currency,
      interval,
      features,
      limits,
      stripePriceId,
      stripeProductId,
      isActive,
      isPopular,
      sortOrder
    } = req.body;
    
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      {
        name,
        description,
        price,
        currency,
        interval,
        features,
        limits,
        stripePriceId,
        stripeProductId,
        isActive,
        isPopular,
        sortOrder,
        updatedAt: new Date()
      },
      { new: true }
    );
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found'
      });
    }
    
    res.json({
      success: true,
      data: plan
    });
  } catch (error) {
    logger.error('Error updating plan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update plan'
    });
  }
});

// Delete plan
app.delete('/api/plans/:id', async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found'
      });
    }
    
    // Soft delete
    plan.isActive = false;
    await plan.save();
    
    res.json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting plan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete plan'
    });
  }
});

// Get plan features
app.get('/api/plans/:id/features', async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id).select('features limits');
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Plan not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        features: plan.features,
        limits: plan.limits
      }
    });
  } catch (error) {
    logger.error('Error fetching plan features:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch plan features'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Keephy Plans Service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  mongoose.connection.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  mongoose.connection.close();
  process.exit(0);
});
