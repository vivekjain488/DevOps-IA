function field(value, name, min, max, required = true) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && !normalized) return { error: `${name} is required.` };
  if (normalized && (normalized.length < min || normalized.length > max)) return { error: `${name} must be between ${min} and ${max} characters.` };
  return { value: normalized };
}
function validateEvent(body = {}) {
  const errors = [], title = field(body.title, 'Title', 3, 100), venue = field(body.venue, 'Venue', 3, 120), description = field(body.description, 'Description', 0, 500, false);
  if (title.error) errors.push({ field: 'title', message: title.error });
  if (venue.error) errors.push({ field: 'venue', message: venue.error });
  if (description.error) errors.push({ field: 'description', message: description.error });
  const eventDate = typeof body.eventDate === 'string' ? new Date(body.eventDate) : null;
  if (!eventDate || Number.isNaN(eventDate.getTime()) || eventDate <= new Date()) errors.push({ field: 'eventDate', message: 'Event date must be a valid future ISO-8601 date-time.' });
  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) errors.push({ field: 'capacity', message: 'Capacity must be an integer from 1 to 1000.' });
  return { errors, value: { title: title.value, venue: venue.value, description: description.value || null, eventDate: eventDate && eventDate.toISOString(), capacity } };
}
function validateRegistration(body = {}) {
  const errors = [], name = field(body.name, 'Name', 2, 80);
  if (name.error) errors.push({ field: 'name', message: name.error });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.push({ field: 'email', message: 'Email must be a valid email address.' });
  return { errors, value: { name: name.value, email } };
}
function validId(id) { return /^\d+$/.test(String(id)) && Number(id) > 0; }
module.exports = { validateEvent, validateRegistration, validId };
