'use strict';

/**
 * Validación de cédula / documento de identidad venezolano.
 * Tipos:
 *  V = venezolano (6 a 9 dígitos)
 *  E = extranjero residente (6 a 9 dígitos)
 *  J = persona jurídica / RIF (8 a 10 dígitos)
 *  G = ente gubernamental (8 a 10 dígitos)
 *  P = pasaporte (6 a 12 caracteres alfanuméricos)
 *
 * El usuario escribe la cédula de muchas formas: "V-12.345.678",
 * "v12345678", "12.345.678", "V 12 345 678". Todas deben funcionar. Si no
 * escribe la letra asumimos V (cédula de venezolano), que es el caso normal.
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

/** Deja solo letras y números en mayúscula y separa el tipo del número. */
function split(input) {
  const raw = String(input == null ? '' : input).trim().toUpperCase();
  // Quitamos puntos, guiones, espacios, barras y cualquier otro separador.
  const clean = raw.replace(/[^A-Z0-9]/g, '');
  if (!clean) return { type: '', number: '' };
  const m = clean.match(/^([VEJGP])([0-9A-Z]+)$/);
  if (m) return { type: m[1], number: m[2] };
  return { type: '', number: clean };
}

function normalize(input) {
  const { type, number } = split(input);
  if (!number) return '';
  if (type) return `${type}-${number}`;
  // Sin letra: si son solo dígitos es una cédula de venezolano.
  if (/^\d+$/.test(number)) return `V-${number}`;
  return number;
}

function parse(input) {
  const { type, number } = split(input);
  if (!number) return null;
  let t = type;
  if (!t) t = /^\d+$/.test(number) ? 'V' : 'P';
  return { type: t, number, normalized: `${t}-${number}` };
}

function validate(input) {
  const parsed = parse(input);
  if (!parsed) {
    return { valid: false, error: 'Escribe tu cédula. Ejemplo: V-12345678.' };
  }
  const rule = RULES[parsed.type];
  if (!rule) {
    return { valid: false, error: 'Tipo de documento no reconocido. Usa V, E, J, G o P.' };
  }
  if (rule.digits && !/^\d+$/.test(parsed.number)) {
    return {
      valid: false,
      error: `La cédula tipo ${parsed.type} solo admite números (sin letras).`,
    };
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
