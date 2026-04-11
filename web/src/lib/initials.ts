/**
 * Generate display initials from a name.
 * "Noe Chague" → "NC", "Noe" → "N", "" → "?"
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts[0]?.length > 0) return parts[0][0].toUpperCase();
  return "?";
}
