// Qibla bearing — great-circle initial bearing from the user's lat/lng to
// the Kaaba (21.4225 N, 39.8262 E). True-north only — magnetic declination
// in PH is small (~0–2°) and an explicit magnetic offset would require a
// per-location table we don't have, so we render this as "true north"
// everywhere and let the user adjust visually against a phone compass.

const KAABA_LAT = 21.4225;
const KAABA_LNG = 39.8262;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

// Returns the initial compass bearing (0° = true north, clockwise) from
// the supplied lat/lng to the Kaaba. Returns null when lat/lng can't be
// read so the UI can show a friendly placeholder rather than NaN.
export function qiblaBearingTrueNorth(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): number | null {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const lat1 = toRadians(latitude);
  const lat2 = toRadians(KAABA_LAT);
  const dLng = toRadians(KAABA_LNG - longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (toDegrees(Math.atan2(y, x)) + 360) % 360;
  return bearing;
}

// Great-circle distance in kilometres (Haversine). Used by the qibla card
// to render "~9,720 km" alongside the bearing so the user knows the scale.
export function distanceToMeccaKm(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): number | null {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const R = 6371; // mean Earth radius in km
  const lat1 = toRadians(latitude);
  const lat2 = toRadians(KAABA_LAT);
  const dLat = toRadians(KAABA_LAT - latitude);
  const dLng = toRadians(KAABA_LNG - longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
