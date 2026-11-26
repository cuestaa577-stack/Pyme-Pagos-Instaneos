'use strict';

/**
 * Validación de cédula / documento de identidad venezolano.
 * Tipos:
 *  V = venezolano (6 a 9 dígitos)
 *  E = extranjero residente (6 a 9 dígitos)
 *  J = persona jurídica (8 a 10 dígitos)
 *  G = ente gubernamental (8 a 10 dígitos)
 *  P = pasaporte (6 a 12 caracteres alfanuméricos)
 *
 * Nota: la cédula venezolana no expone públicamente un dígito verificador
 * calculable, por lo que esta función valida estructura, tipo y longitud.
 * La verificación de identidad real (KYC) debe hacerla un proveedor autorizado.
 */

const RULES = {
  V: { min: 6, max: 9, digits: true, label: 'Venezolano' },
  E: { min: 6, max: 9, digits: true, label: 'Extranjero' },
  J: { min: 8, max: 10, digits: true, label: 'Jurídico' },
  G: { min: 8, max: 10, digits: true, label: 'Gubernamental' },
  P: { min: 6, max: 12, digits: false, label: 'Pasaporte' },
};

function normalize(input) {
  if (input === null || input === undefined) return '';
  let s = String(input).trim().toUpperCase().replace(/\s+/g, '');
  s = s.replace(/[^VEJGP0-9-]/g, '');
  let type = '';
  const m = s.match(/^([VEJGP])-?([0-9A-Z]+)$/);
  if (m) {
    type = m[1];
    s = m[2];
  } else {
    s = s.replace(/-/g, '');
  }
  s = s.replace(/-/g, '');
  return type ? `${type}-${s}` : s;
}

function parse(input) {
  const normalized = normalize(input);
  const m = normalized.match(/^([VEJGP])-([0-9A-Z]+)$/);
  if (!m) return null;
  return { type: m[1], number: m[2], normalized };
}

function validate(input) {
  const parsed = parse(input);
  if (!parsed) {
    return { valid: false, error: 'Formato inválido. Usa por ejemplo V-12345678.' };
  }
  const rule = RULES[parsed.type];
  if (rule.digits && !/^\d+$/.test(parsed.number)) {
    return { valid: false, error: `La cédula tipo ${parsed.type} solo admite números.` };
  }
  if (!rule.digits && !/^[0-9A-Z]+$/.test(parsed.number)) {
    return { valid: false, error: 'El pasaporte solo admite letras y números.' };
  }
  if (parsed.number.length < rule.min || parsed.number.length > rule.max) {
    return {
      valid: false,
      error: `El documento tipo ${parsed.type} debe tener entre ${rule.min} y ${rule.max} caracteres.`,
    };
  }
  if (rule.digits && /^(\d)\1+$/.test(parsed.number)) {
    return { valid: false, error: 'El número de documento no puede ser una secuencia repetida.' };
  }
  return {
    valid: true,
    type: parsed.type,
    number: parsed.number,
    normalized: parsed.normalized,
    label: rule.label,
  };
}

function mask(input) {
  const parsed = parse(input);
  if (!parsed) return '***';
  const visible = parsed.number.slice(-3);
  return `${parsed.type}-***${visible}`;
}

module.exports = { RULES, normalize, parse, validate, mask };
