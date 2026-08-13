export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=UTF-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // =========================
    // LIRE LES RÉSERVATIONS
    // =========================
    if (url.pathname === "/reservations" && request.method === "GET") {
      const data = await env.RESERVATIONS.get("reservations");

      return new Response(data || "[]", {
        headers
      });
    }

    // =========================
    // AJOUTER UNE RÉSERVATION
    // =========================
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
          JSON.stringify({
            success: false,
            message: "Informations manquantes."
          }),
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
          reservationId: reservation.id,
          message: "Demande de réservation enregistrée."
        }),
        { headers }
      );
    }

    // =========================
    // CRÉER LE PAIEMENT SUMUP
    // =========================
    if (url.pathname === "/create-checkout" && request.method === "POST") {
      try {
        const booking = await request.json();

        if (
          !booking.logement ||
          !booking.arrivee ||
          !booking.depart
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Informations de réservation manquantes."
            }),
            { status: 400, headers }
          );
        }

        const arrivee = new Date(booking.arrivee + "T00:00:00Z");
        const depart = new Date(booking.depart + "T00:00:00Z");

        const nuits = Math.round(
          (depart.getTime() - arrivee.getTime()) / 86400000
        );

        if (!Number.isFinite(nuits) || nuits <= 0) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Dates de séjour invalides."
            }),
            { status: 400, headers }
          );
        }

        const logement = String(booking.logement).toLowerCase();

        let prixNuit;

        if (logement.includes("maison")) {
          prixNuit = 200;
        } else if (logement.includes("studio")) {
          prixNuit = 65;
        } else {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Logement inconnu."
            }),
            { status: 400, headers }
          );
        }

        const montant = nuits * prixNuit;
        const reference = "EV-" + crypto.randomUUID();

        const sumupResponse = await fetch(
          "https://api.sumup.com/v0.1/checkouts",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.SUMUP_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              merchant_code: "M4TDFVD8",
              amount: montant,
              currency: "EUR",
              checkout_reference: reference,
              description:
                `L'Echappee Verte - ${booking.logement} - ${nuits} nuit(s)`,
              redirect_url: `${url.origin}/index.html?paiement=retour`,
              hosted_checkout: {
                enabled: true
              }
            })
          }
        );

        const checkout = await sumupResponse.json();

        if (!sumupResponse.ok) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Impossible de créer le paiement SumUp.",
              details: checkout
            }),
            { status: 502, headers }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            montant,
            nuits,
            checkoutId: checkout.id,
            paymentUrl: checkout.hosted_checkout_url
          }),
          { headers }
        );

      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Erreur lors de la création du paiement.",
            error: error.message
          }),
          { status: 500, headers }
        );
      }
    }
    // ==============================
// VERIFIER LE PAIEMENT SUMUP
// ==============================
if (url.pathname === "/check-payment" && request.method === "GET") {

  const checkoutId = url.searchParams.get("checkoutId");

  if (!checkoutId) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Identifiant de paiement manquant"
      }),
      { status: 400, headers }
    );
  }

  const sumupResponse = await fetch(
    `https://api.sumup.com/v0.1/checkouts/${checkoutId}`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${env.SUMUP_API_KEY}`
      }
    }
  );

  const checkout = await sumupResponse.json();

  if (!sumupResponse.ok) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Impossible de vérifier le paiement"
      }),
      { status: 502, headers }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      paid: checkout.status === "PAID",
      status: checkout.status
    }),
    { headers }
  );
}

    // =========================
    // SUPPRIMER UNE RÉSERVATION
    // =========================
    if (url.pathname === "/reservations" && request.method === "DELETE") {
      const suppression = await request.json();

      if (
        !suppression.logement ||
        !suppression.arrivee ||
        !suppression.depart
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Informations manquantes."
          }),
          { status: 400, headers }
        );
      }

      const data = await env.RESERVATIONS.get("reservations");
      const reservations = data ? JSON.parse(data) : [];

      const index = reservations.findIndex(r =>
        r.logement === suppression.logement &&
        r.arrivee === suppression.arrivee &&
        r.depart === suppression.depart
      );

      if (index === -1) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Réservation introuvable."
          }),
          { status: 404, headers }
        );
      }

      reservations.splice(index, 1);

      await env.RESERVATIONS.put(
        "reservations",
        JSON.stringify(reservations)
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "Dates débloquées."
        }),
        { headers }
      );
    }

    // =========================
    // SITE
    // =========================
    if (
      url.pathname === "/" ||
      url.pathname === "/index.html" ||
      url.pathname === "/Index.html"
    ) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
    }

    return new Response(
      JSON.stringify({
        message: "L'Échappée Verte - API réservation"
      }),
      { headers }
    );
  }
};
