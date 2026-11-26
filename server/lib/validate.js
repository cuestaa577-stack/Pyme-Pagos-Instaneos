'use strict';
const { z } = require('zod');
const cedula = require('./cedula');

const docSchema = z
  .string()
  .trim()
  .min(6, 'Escribe tu cédula completa. Ejemplo: V-12345678.')
  .max(20, 'El documento no puede tener más de 20 caracteres.')
  .refine((v) => cedula.validate(v).valid, { message: 'Cédula venezolana inválida.' });

// Documento genérico para operaciones fuera de Venezuela (RUT chileno, DNI
// peruano/argentino, CURP, etc.). Solo se exige un identificador razonable.
const genericDocSchema = z
  .string()
  .trim()
  .min(5, 'El documento debe tener al menos 5 caracteres.')
  .max(24, 'El documento no puede tener más de 24 caracteres.')
  .regex(/^[A-Za-z0-9.\-\s]+$/, { message: 'Documento de identidad inválido: usa solo letras, números, puntos o guiones.' });

const personSchema = z.object({
  fullName: z.string().trim().min(3, 'Escribe tu nombre completo.').max(100, 'El nombre es demasiado largo.'),
  email: z.string().trim().email('Escribe un correo válido (ejemplo: tu@correo.com).').max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(30, 'El teléfono es demasiado largo.').optional().or(z.literal('')),
  document: z.string().trim().min(5, 'Escribe tu documento de identidad.').max(24, 'El documento no puede tener más de 24 caracteres.'),
  documentType: z.string().trim().max(20).optional().or(z.literal('')),
});

const beneficiarySchema = z.object({
  beneficiaryName: z.string().trim().min(3, 'Escribe el nombre del beneficiario.').max(100, 'El nombre del beneficiario es demasiado largo.'),
  beneficiaryDocument: z.string().trim().min(5, 'Escribe el documento del beneficiario.').max(24, 'El documento del beneficiario no puede tener más de 24 caracteres.'),
  beneficiaryEmail: z.string().trim().email('El correo del beneficiario no es válido.').max(120).optional().or(z.literal('')),
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
  amountCents: z.number({ message: 'El monto no es válido.' }).int('El monto debe ser un número entero.').positive('El monto debe ser mayor que cero.'),
  currency: z.enum(['USD', 'COP', 'VES', 'CLP', 'PEN', 'ARS', 'MXN', 'DOP', 'EUR', 'BRL', 'PYG', 'UYU'], { message: 'Moneda no soportada.' }),
  payerCountry: z.string().length(2, 'País de origen inválido.'),
  country: z.string().length(2, 'País de destino inválido.'),
  direction: z.enum(['send', 'receive'], { message: 'Dirección inválida.' }).default('send'),
  method: z.enum([
    'card',
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
  ], { message: 'Método de pago no válido.' }),
  payerBank: z.string().trim().max(20).optional().or(z.literal('')),
  description: z.string().trim().max(100, 'El concepto no puede pasar de 100 caracteres.').optional(),
}).superRefine((data, ctx) => {
  /*
   * Cada documento se valida contra SU país:
   *  - El documento del pagador contra `payerCountry` (quien paga puede estar
   *    en Chile y su documento es un RUT, no una cédula venezolana).
   *  - El documento del beneficiario contra `country` (el país que entrega).
   *
   * Antes se exigía cédula venezolana a ambos en cuanto la operación tocara
   * Venezuela, y por eso un chileno enviando a Venezuela recibía
   * "Formato inválido. Usa por ejemplo V-12345678" aunque escribiera bien su
   * RUT. Ese era el error que bloqueaba todos los envíos.
   */
  const payerIsVe = String(data.payerCountry).toUpperCase() === 'VE';
  const destIsVe = String(data.country).toUpperCase() === 'VE';

  if (payerIsVe) {
    const r = cedula.validate(data.document);
    if (!r.valid) {
      ctx.addIssue({ code: 'custom', path: ['document'], message: r.error });
    }
  } else if (!genericDocSchema.safeParse(data.document).success) {
    ctx.addIssue({
      code: 'custom',
      path: ['document'],
      message: 'Escribe un documento de identidad válido (mínimo 5 caracteres, sin símbolos raros).',
    });
  }

  if (destIsVe) {
    const r = cedula.validate(data.beneficiaryDocument);
    if (!r.valid) {
      ctx.addIssue({
        code: 'custom',
        path: ['beneficiaryDocument'],
        message: `Documento del beneficiario: ${r.error}`,
      });
    }
  } else if (!genericDocSchema.safeParse(data.beneficiaryDocument).success) {
    ctx.addIssue({
      code: 'custom',
      path: ['beneficiaryDocument'],
      message: 'El documento del beneficiario no es válido.',
    });
  }
});

const loginSchema = z.object({
  email: z.string().trim().email('Escribe un correo válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.').max(200, 'La contraseña es demasiado larga.'),
});

const withdrawalSchema = z.object({
  amountCents: z.number({ message: 'Monto inválido.' }).int('Monto inválido.').positive('El monto debe ser mayor que cero.'),
  currency: z.enum(['USD', 'COP', 'VES'], { message: 'Moneda no soportada para retiros.' }),
  keyType: z.enum(['cedula', 'phone', 'email', 'alphanumeric'], { message: 'Tipo de llave inválido.' }),
  keyValue: z.string().trim().min(4, 'Escribe la llave o cuenta de destino.').max(60),
  destinationName: z.string().trim().max(100).optional(),
  bankName: z.string().trim().max(80).optional(),
  rail: z.enum(['breb', 'pago_movil_ve', 'transfer_ve']).optional(),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  bankCode: z.string().trim().max(20).optional().or(z.literal('')),
  idempotencyKey: z.string().trim().max(100).optional(),
});

const payoutSchema = z.object({
  beneficiaryId: z.number({ message: 'Selecciona un beneficiario.' }).int().positive('Selecciona un beneficiario.'),
  amountCents: z.number({ message: 'Monto inválido.' }).int('Monto inválido.').positive('El monto debe ser mayor que cero.'),
  sourceCurrency: z.enum(['USD', 'COP', 'VES'], { message: 'Moneda de origen no soportada.' }).default('USD'),
  purpose: z.string().trim().max(40).optional(),
  description: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

const dlocalPayoutSchema = z.object({
  beneficiaryId: z.number({ message: 'Selecciona un beneficiario.' }).int().positive('Selecciona un beneficiario.'),
  amountCents: z.number({ message: 'Monto inválido.' }).int('Monto inválido.').positive('El monto debe ser mayor que cero.'),
  currency: z.string().length(3, 'Moneda inválida.'),
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
