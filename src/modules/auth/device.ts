import { Request } from 'express';

export interface ClientContext {
  ip: string | null;
  userAgent: string | null;
}

export function clientContext(req: Request): ClientContext {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const match = (ua: string, table: [RegExp, string][]) => table.find(([re]) => re.test(ua))?.[1];

/**
 * Good-enough user-agent parsing for the Devices list ("Chrome on Windows",
 * "Chrome · Windows"). Order matters: Edge and Opera also contain "Chrome".
 */
export function describeDevice(userAgent: string | null): { deviceName: string; detail: string } {
  const ua = userAgent ?? '';
  const browser = match(ua, BROWSERS) ?? 'Unknown browser';
  const os = match(ua, SYSTEMS) ?? 'Unknown OS';
  return { deviceName: `${browser} on ${os}`, detail: `${browser} · ${os}` };
}
