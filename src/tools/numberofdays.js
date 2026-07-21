/**
 * Calculates the number of days between two dates.
 * @param {string | Date} start - The start date.
 * @param {string | Date} end - The end date.
 * @returns {number} The exact number of days between the dates.
 */
export function getNumberOfDays(start, end) {
    const date1 = new Date(start);
    const date2 = new Date(end);

    // One day in milliseconds
    const oneDay = 1000 * 60 * 60 * 24;

    // Calculating the time difference between two dates
    const diffInTime = date2.getTime() - date1.getTime();

    // Return exact float to prevent early 72-hour expiration
    return diffInTime / oneDay;
}
