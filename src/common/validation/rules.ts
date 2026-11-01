/**
 * Server-side copies of the client's validation rules (spec: "Server-side
 * validation must repeat the client rules"). NIN regex matches
 * karevo-users-dashboard/src/lib/nin.ts.
 */
export const NIN_REGEX = /^\d{11}$/;
export const NIN_MESSAGE = 'NIN must be exactly 11 digits';

export const PIN_REGEX = /^\d{4}$/;
export const PIN_MESSAGE = 'PIN must be exactly 4 digits';

export const PASSWORD_MIN = 8;
export const PASSWORD_MESSAGE = `Password must be at least ${PASSWORD_MIN} characters`;

export const CONSENT_DAYS = [7, 30, 90] as const;

const TRIVIAL_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '1212', '2580', '0852', '1004', '2000', '6969', '1122', '0123',
]);

export function isTrivialPin(pin: string): boolean {
  return TRIVIAL_PINS.has(pin);
}
