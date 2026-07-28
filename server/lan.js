import { networkInterfaces } from 'node:os';

import { config } from './config.js';

const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

// Wired first, then wireless, then anything else — on a Pi with both eth0 and
// wlan0 up, the wired address is the stable one to hand guests.
function interfaceRank(name) {
  if (/^(eth|en)/i.test(name)) return 0;
  if (/^(wlan|wl|wlp)/i.test(name)) return 1;
  return 2;
}

/**
 * The address guests will actually type or scan. Returns null when nothing
 * usable is found, which the caller surfaces as a setup warning rather than
 * silently handing out a loopback address that no phone can reach.
 */
export function detectLanIp() {
  if (config.hostLanIp) return config.hostLanIp;

  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (!PRIVATE_RANGES.some((range) => range.test(address.address))) continue;
      candidates.push({ name, address: address.address });
    }
  }

  candidates.sort((a, b) => interfaceRank(a.name) - interfaceRank(b.name));
  return candidates[0]?.address ?? null;
}

export function baseUrl() {
  const ip = detectLanIp();
  return ip ? `http://${ip}:${config.port}` : null;
}
