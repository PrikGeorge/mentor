// FE-14: small helpers that several screens used to repeat by hand.

// The avatar letter of a name; «·» when the name is blank.
export function initialOf(name: string): string {
    return name.trim().slice(0, 1).toUpperCase() || '·';
}

// Today's (or `now`'s) calendar date in Moscow as YYYY-MM-DD: lessons are stored as Moscow wall-clock dates.
export function moscowDate(now = Date.now()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
