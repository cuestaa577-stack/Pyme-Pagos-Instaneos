'use strict';
const { z } = require('zod');
const cedula = require('./cedula');

const docSchema = z
  .string()
  .min(6)
  .max(20)
  .refine((v) => cedula.validate(v).valid, { message: 'Cédula venezolana inválida.' });

// Documento genérico para operaciones fuera de Venezuela (RUT chileno, DNI
// peruano/argentino, CURP, etc.). Solo se exige un identificador razonable.
const genericDocSchema = z
  .string()
  .trim()
  .min(5)
  .max(24)
  .regex(/^[A-Za-z0-9.\-\s]+$/, { message: 'Documento de identidad inválido.' });

const personSchema = z.object({
  fullName: z.string().trim().min(3).max(100),
  email: z.string().email().max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  document: z.string().trim().min(5).max(24),
  documentType: z.string().trim().max(20).optional().or(z.literal('')),
});

const beneficiarySchema = z.object({
  beneficiaryName: z.string().trim().min(3).max(100),
  beneficiaryDocument: z.string().trim().min(5).max(24),
  beneficiaryEmail: z.string().email().max(120).optional().or(z.literal('')),
  beneficiaryPhone: z.string().trim().max(30).optional().or(z.literal('')),
  rail: z.enum([
    'breb',
    'pago_movil',
    'bank',
    'pago_movil_ve',
    'transfer_ve',
    'cash_ve',
    'wallet',
    'cash_pickup',
  ]),
  keyType: z.enum(['cedula', 'phone', 'email', 'alphanumeric']).optional(),
  brebKey: z.string().trim().max(60).optional().or(z.literal('')),
  bankCode: z.string().trim().max(20).optional().or(z.literal('')),
  bankName: z.string().trim().max(80).optional().or(z.literal('')),
  accountNumber: z.string().trim().max(40).optional().or(z.literal('')),
  accountType: z.enum(['CHECKING', 'SAVINGS', 'VISTA', 'ALIAS']).optional(),
});

const orderSchema = personSchema.merge(beneficiarySchema).extend({
  amountCents: z.number().int().positive(),
  currency: z.enum(['USD', 'COP', 'VES', 'CLP', 'PEN', 'ARS', 'MXN', 'DOP', 'EUR', 'BRL', 'PYG', 'UYU']),
  payerCountry: z.string().length(2),
  country: z.string().length(2),
  direction: z.enum(['send', 'receive']).default('send'),
  method: z.enum([
    'card',
    'card_transparent',
    'cash',
    'pse',
    'breb',
    'co_nequi',
    'co_daviplata',
    've_pago_movil',
    've_transfer',
    've_cash',
    'cl_webpay',
    'cl_mercadopago',
    'cl_transfer',
    'cash_cl',
    'pe_yape',
    'pe_plin',
    'pe_transfer',
    'cash_pe',
    'ar_mercadopago',
    'ar_transfer',
    'cash_ar',
    'mx_spei',
    'mx_oxxo',
    'mx_transfer',
    'cash_mx',
    'ec_transfer',
    'ec_pichincha',
    'cash_ec',
    'pa_ach',
    'pa_yappy',
    'cash_pa',
    'do_tpago',
    'do_transfer',
    'cash_do',
    'es_bizum',
    'es_sepa',
    'cash_es',
    'us_ach',
    'us_zelle',
    'cash_us',
  ]),
  payerBank: z.string().trim().max(20).optional().or(z.literal('')),
  description: z.string().trim().max(100).optional(),
}).superRefine((data, ctx) => {
  // La cédula venezolana es obligatoria cuando la operación toca Venezuela.
  const touchesVe = data.country === 'VE' || data.payerCountry === 'VE';
  if (touchesVe) {
    for (const field of ['document', 'beneficiaryDocument']) {
      if (!cedula.validate(data[field]).valid) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message:
            field === 'document'
              ? 'Cédula venezolana inválida.'
              : 'Cédula venezolana del beneficiario inválida.',
        });
      }
    }
  } else {
    for (const field of ['document', 'beneficiaryDocument']) {
      if (!genericDocSchema.safeParse(data[field]).success) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Documento de identidad inválido.' });
      }
    }
  }
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
