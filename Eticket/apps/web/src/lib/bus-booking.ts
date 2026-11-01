export interface BusBookingInfo {
  origin: string;
  destination: string;
  travelDate: string;
  departure: string;
  seatNumbers: string[];
}

export function getBusBookingInfo(identifier: string): BusBookingInfo | null {
  try {
    const stored = window.localStorage.getItem(`bus-booking-${identifier}`);
    if (!stored) return null;

    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== "object") return null;

    const booking = value as Partial<BusBookingInfo>;
    if (
      typeof booking.origin !== "string" ||
      typeof booking.destination !== "string" ||
      typeof booking.travelDate !== "string" ||
      typeof booking.departure !== "string" ||
      !Array.isArray(booking.seatNumbers) ||
      !booking.seatNumbers.every((seat) => typeof seat === "string")
    ) {
      return null;
    }

    return {
      origin: booking.origin,
      destination: booking.destination,
      travelDate: booking.travelDate,
      departure: booking.departure,
      seatNumbers: booking.seatNumbers,
    };
  } catch (error) {
    console.warn("Detail perjalanan demo tidak dapat dibaca.", error);
    return null;
  }
}

export function saveTicketBookings(
  tickets: Array<{ id: string }>,
  booking: BusBookingInfo
) {
  try {
    tickets.forEach((ticket, index) => {
      window.localStorage.setItem(
        `bus-booking-${ticket.id}`,
        JSON.stringify({
          ...booking,
          seatNumbers: booking.seatNumbers[index]
            ? [booking.seatNumbers[index]]
            : [],
        })
      );
    });
  } catch (error) {
    console.warn("Detail kursi demo tidak dapat disimpan di browser.", error);
  }
}
