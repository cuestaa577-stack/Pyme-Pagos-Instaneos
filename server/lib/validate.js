'use strict';
const { z } = require('zod');
const cedula = require('./cedula');

const docSchema = z
  .string()
  .min(6)
  .max(20)
  .refine((v) => cedula.validate(v).valid, { message: 'Cédula venezolana inválida.' });

const personSchema = z.object({
  fullName: z.string().trim().min(3).max(100),
  email: z.string().email().max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  document: docSchema,
});

const beneficiarySchema = z.object({
  beneficiaryName: z.string().trim().min(3).max(100),
  beneficiaryDocument: docSchema,
  beneficiaryEmail: z.string().email().max(120).optional().or(z.literal('')),
  beneficiaryPhone: z.string().trim().max(30).optional().or(z.literal('')),
  rail: z.enum(['breb', 'pago_movil', 'bank', 'pago_movil_ve', 'transfer_ve', 'cash_ve']),
  keyType: z.enum(['cedula', 'phone', 'email', 'alphanumeric']).optional(),
  brebKey: z.string().trim().max(60).optional().or(z.literal('')),
  bankCode: z.string().trim().max(20).optional().or(z.literal('')),
  bankName: z.string().trim().max(80).optional().or(z.literal('')),
  accountNumber: z.string().trim().max(40).optional().or(z.literal('')),
  accountType: z.enum(['CHECKING', 'SAVINGS', 'VISTA', 'ALIAS']).optional(),
});

const orderSchema = personSchema.merge(beneficiarySchema).extend({
  amountCents: z.number().int().positive(),
  currency: z.enum(['USD', 'COP', 'VES']),
  payerCountry: z.string().length(2),
  country: z.string().length(2),
  method: z.enum([
    'card',
    'card_transparent',
    'pse',
    'breb',
    'cash',
    've_pago_movil',
    've_transfer',
    've_cash',
  ]),
  payerBank: z.string().trim().max(20).optional().or(z.literal('')),
  description: z.string().trim().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

const withdrawalSchema = z.object({
  amountCents: z.number().int().positive(),
  currency: z.enum(['USD', 'COP', 'VES']),
  keyType: z.enum(['cedula', 'phone', 'email', 'alphanumeric']),
  keyValue: z.string().trim().min(4).max(60),
  destinationName: z.string().trim().max(100).optional(),
  bankName: z.string().trim().max(80).optional(),
  rail: z.enum(['breb', 'pago_movil_ve', 'transfer_ve']).optional(),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  bankCode: z.string().trim().max(20).optional().or(z.literal('')),
  idempotencyKey: z.string().trim().max(100).optional(),
});

const payoutSchema = z.object({
  beneficiaryId: z.number().int().positive(),
  amountCents: z.number().int().positive(),
  sourceCurrency: z.enum(['USD', 'COP', 'VES']).default('USD'),
  purpose: z.string().trim().max(40).optional(),
  description: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

const dlocalPayoutSchema = z.object({
  beneficiaryId: z.number().int().positive(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
  purpose: z.string().trim().max(40).default('REWARDS'),
  flowType: z.enum(['B2B', 'B2C']).default('B2C'),
  businessName: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const err = new Error(issue?.message || 'Datos inválidos.');
    err.status = 400;
    err.details = result.error.issues;
    throw err;
  }
  return result.data;
}

module.exports = {
  docSchema,
  personSchema,
  beneficiarySchema,
  orderSchema,
  loginSchema,
  withdrawalSchema,
  payoutSchema,
  dlocalPayoutSchema,
  parse,
};
