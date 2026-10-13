const LIMIT = 25;
const SEPARATOR = ' → ';
const DOTS = '...';
const characters = (value: string) => Array.from(value);

function shorten(value: string, budget: number): string {
  const chars = characters(value);
  return chars.length <= budget ? value : chars.slice(0, budget - DOTS.length).join('') + DOTS;
}

/** The entire location, including spaces, arrow and three dots, fits 25 characters. */
export function tableHeaderLocation(roomName: string, tableName: string, path = ''): string {
  if (!roomName && path) {
    const arrow = path.lastIndexOf(SEPARATOR);
    if (arrow >= 0) {
      roomName = path.slice(0, arrow);
      tableName = path.slice(arrow + SEPARATOR.length);
    } else {
      return shorten(path, LIMIT);
    }
  }
  if (!roomName) return shorten(tableName, LIMIT);
  const location = `${roomName}${SEPARATOR}${tableName}`;
  if (characters(location).length <= LIMIT) return location;
  // Normally only the room is shortened. An unusually long table name must
  // also fit while leaving room for the room's three dots and the separator.
  const table = shorten(tableName, LIMIT - SEPARATOR.length - DOTS.length);
  const roomBudget = LIMIT - SEPARATOR.length - characters(table).length;
  return `${shorten(roomName, roomBudget)}${SEPARATOR}${table}`;
}
