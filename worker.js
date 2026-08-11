export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=UTF-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (url.pathname === "/reservations" && request.method === "GET") {
      const data = await env.RESERVATIONS.get("reservations");
      return new Response(data || "[]", { headers });
    }

    if (url.pathname === "/reservations" && request.method === "POST") {
      const reservation = await request.json();

      if (
        !reservation.logement ||
        !reservation.arrivee ||
        !reservation.depart ||
        !reservation.nom ||
        !reservation.email
      ) {
        return new Response(
          JSON.stringify({ success: false, message: "Informations manquantes." }),
          { status: 400, headers }
        );
      }

      const data = await env.RESERVATIONS.get("reservations");
      const reservations = data ? JSON.parse(data) : [];

      const conflit = reservations.some(r =>
        r.logement === reservation.logement &&
        reservation.arrivee < r.depart &&
        reservation.depart > r.arrivee
      );

      if (conflit) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Ces dates sont déjà réservées."
          }),
          { status: 409, headers }
        );
      }

      reservation.id = crypto.randomUUID();
      reservation.createdAt = new Date().toISOString();

      reservations.push(reservation);

      await env.RESERVATIONS.put(
        "reservations",
        JSON.stringify(reservations)
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "Demande de réservation enregistrée."
        }),
        { headers }
      );
    }

    return new Response(
      JSON.stringify({ message: "L'Échappée Verte - API réservation" }),
      { headers }
    );
  }
};
