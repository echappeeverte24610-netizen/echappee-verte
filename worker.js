function estMaison(logement) {
  return String(logement || "").toLowerCase().includes("maison");
}

function estStudio(logement) {
  return String(logement || "").toLowerCase().includes("studio");
}

function dateIcalVersIso(valeur) {
  const match = String(valeur || "").match(/(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function lireCalendrierIcal(texte) {
  const unfolded = texte.replace(/\r?\n[ \t]/g, "");
  const blocs = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  return blocs.map(bloc => {
    const debut =
      bloc.match(/DTSTART(?:;[^:]*)?:(\d{8})/)?.[1] || null;

    const fin =
      bloc.match(/DTEND(?:;[^:]*)?:(\d{8})/)?.[1] || null;

    return {
      arrivee: dateIcalVersIso(debut),
      depart: dateIcalVersIso(fin)
    };
  }).filter(r => r.arrivee && r.depart);
}

async function reservationsAirbnb(urlIcal, nom) {
  if (!urlIcal) return [];

  try {
    const response = await fetch(urlIcal, {
      headers: {
        "User-Agent": "Echappee-Verte-Calendar-Sync"
      }
    });

    if (!response.ok) {
      console.log(
        `Erreur calendrier Airbnb ${nom} :`,
        response.status
      );
      return [];
    }

    const ical = await response.text();
    return lireCalendrierIcal(ical);

  } catch (error) {
    console.log(
      `Erreur récupération Airbnb ${nom} :`,
      error
    );
    return [];
  }
}

async function reservationsAirbnbMaison(env) {
  return reservationsAirbnb(
    env.AIRBNB_MAISON_ICAL,
    "Maison"
  );
}

async function reservationsAirbnbStudio(env) {
  return reservationsAirbnb(
    env.AIRBNB_STUDIO_ICAL,
    "Studio"
  );
}

function conflitDates(arrivee, depart, reservation) {
  return (
    arrivee < reservation.depart &&
    depart > reservation.arrivee
  );
}

function echapperIcal(texte) {
  return String(texte || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function dateIsoVersIcal(date) {
  return String(date || "").replaceAll("-", "");
}

function calendrierLogement(reservations, type) {
  const maison = type === "maison";
  const nom = maison ? "Maison" : "Studio";
  const correspond = maison ? estMaison : estStudio;

  const lignes = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//L'Echappee Verte//Reservations ${nom}//FR`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:L'Echappée Verte - ${nom}`
  ];

  for (const r of reservations) {
    if (!correspond(r.logement)) continue;
    if (!r.arrivee || !r.depart) continue;

    lignes.push(
      "BEGIN:VEVENT",
      `UID:${echapperIcal(
        r.id || crypto.randomUUID()
      )}@echappee-verte`,
      `DTSTART;VALUE=DATE:${dateIsoVersIcal(r.arrivee)}`,
      `DTEND;VALUE=DATE:${dateIsoVersIcal(r.depart)}`,
      "SUMMARY:Réservé - L'Échappée Verte",
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }

  lignes.push("END:VCALENDAR");

  return lignes.join("\r\n");
}

function calendrierMaison(reservations) {
  return calendrierLogement(reservations, "maison");
}

function calendrierStudio(reservations) {
  return calendrierLogement(reservations, "studio");
}

async function conflitAvecAirbnb(reservation, env) {
  let airbnb = [];

  if (estMaison(reservation.logement)) {
    airbnb = await reservationsAirbnbMaison(env);

  } else if (estStudio(reservation.logement)) {
    airbnb = await reservationsAirbnbStudio(env);

  } else {
    return false;
  }

  return airbnb.some(r =>
    conflitDates(
      reservation.arrivee,
      reservation.depart,
      r
    )
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type",
      "Content-Type":
        "application/json; charset=UTF-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // ==========================================
    // CALENDRIERS MAISON ET STUDIO VERS AIRBNB
    // ==========================================

    if (
      (
        url.pathname === "/calendar/maison.ics" ||
        url.pathname === "/calendar/studio.ics"
      ) &&
      request.method === "GET"
    ) {
      const data =
        await env.RESERVATIONS.get("reservations");

      const reservations =
        data ? JSON.parse(data) : [];

      const ical =
        url.pathname === "/calendar/maison.ics"
          ? calendrierMaison(reservations)
          : calendrierStudio(reservations);

      return new Response(ical, {
        headers: {
          "Content-Type":
            "text/calendar; charset=UTF-8",
          "Cache-Control":
            "no-cache, no-store, must-revalidate",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // =========================
    // VERIFIER DISPONIBILITES
    // =========================

    if (
      url.pathname === "/check-availability" &&
      request.method === "POST"
    ) {
      const reservation = await request.json();

      if (
        !reservation.logement ||
        !reservation.arrivee ||
        !reservation.depart
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Informations manquantes."
          }),
          {
            status: 400,
            headers
          }
        );
      }

      const data =
        await env.RESERVATIONS.get("reservations");

      const reservations =
        data ? JSON.parse(data) : [];

      let conflit = reservations.some(r =>
        r.logement === reservation.logement &&
        conflitDates(
          reservation.arrivee,
          reservation.depart,
          r
        )
      );

      // Vérifie Airbnb Maison OU Studio

      if (!conflit) {
        conflit =
          await conflitAvecAirbnb(
            reservation,
            env
          );
      }

      if (conflit) {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              "Ces dates sont déjà réservées."
          }),
          {
            status: 409,
            headers
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Dates disponibles."
        }),
        { headers }
      );
    }

    // =========================
    // LIRE LES RESERVATIONS
    // =========================

    if (
      url.pathname === "/reservations" &&
      request.method === "GET"
    ) {
      const data =
        await env.RESERVATIONS.get("reservations");

      return new Response(
        data || "[]",
        { headers }
      );
    }

    // =========================
    // AJOUTER UNE RESERVATION
    // =========================

    if (
      url.pathname === "/reservations" &&
      request.method === "POST"
    ) {
      const reservation =
        await request.json();

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
            message:
              "Informations manquantes."
          }),
          {
            status: 400,
            headers
          }
        );
      }

      const data =
        await env.RESERVATIONS.get(
          "reservations"
        );

      const reservations =
        data ? JSON.parse(data) : [];

      let conflit = reservations.some(r =>
        r.logement === reservation.logement &&
        conflitDates(
          reservation.arrivee,
          reservation.depart,
          r
        )
      );

      // Double sécurité Airbnb
      // Maison ET Studio

      if (!conflit) {
        conflit =
          await conflitAvecAirbnb(
            reservation,
            env
          );
      }

      if (conflit) {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              "Ces dates sont déjà réservées."
          }),
          {
            status: 409,
            headers
          }
        );
      }

      reservation.id =
        crypto.randomUUID();

      reservation.createdAt =
        new Date().toISOString();

      reservations.push(reservation);

      await env.RESERVATIONS.put(
        "reservations",
        JSON.stringify(reservations)
      );

      return new Response(
        JSON.stringify({
          success: true,
          reservationId:
            reservation.id,
          message:
            "Demande de réservation enregistrée."
        }),
        { headers }
      );
    }

    // =========================
    // PAIEMENT SUMUP
    // =========================

    if (
      url.pathname === "/create-checkout" &&
      request.method === "POST"
    ) {
      try {
        const booking =
          await request.json();

        if (
          !booking.logement ||
          !booking.arrivee ||
          !booking.depart
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Informations de réservation manquantes."
            }),
            {
              status: 400,
              headers
            }
          );
        }

        const arrivee =
          new Date(
            booking.arrivee +
            "T00:00:00Z"
          );

        const depart =
          new Date(
            booking.depart +
            "T00:00:00Z"
          );

        const nuits =
          Math.round(
            (
              depart.getTime() -
              arrivee.getTime()
            ) / 86400000
          );

        if (
          !Number.isFinite(nuits) ||
          nuits <= 0
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Dates de séjour invalides."
            }),
            {
              status: 400,
              headers
            }
          );
        }

        const logement =
          String(
            booking.logement
          ).toLowerCase();

        let prixNuit;

        if (
          logement.includes("maison")
        ) {
          prixNuit = 200;

        } else if (
          logement.includes("studio")
        ) {
          prixNuit = 65;

        } else {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Logement inconnu."
            }),
            {
              status: 400,
              headers
            }
          );
        }

        const montant =
          nuits * prixNuit;

        const reference =
          "EV-" +
          crypto.randomUUID();

        const sumupResponse =
          await fetch(
            "https://api.sumup.com/v0.1/checkouts",
            {
              method: "POST",

              headers: {
                "Authorization":
                  `Bearer ${env.SUMUP_API_KEY}`,
                "Content-Type":
                  "application/json"
              },

              body: JSON.stringify({
                merchant_code:
                  "M4TDFVD8",

                amount: montant,

                currency: "EUR",

                checkout_reference:
                  reference,

                description:
                  `L'Echappee Verte - ${booking.logement} - ${nuits} nuit(s)`,

                redirect_url:
                  `${url.origin}/index.html?paiement=retour`,

                hosted_checkout: {
                  enabled: true
                }
              })
            }
          );

        const checkout =
          await sumupResponse.json();

        if (!sumupResponse.ok) {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Impossible de créer le paiement SumUp.",
              details:
                checkout
            }),
            {
              status: 502,
              headers
            }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            montant,
            nuits,
            checkoutId:
              checkout.id,
            paymentUrl:
              checkout.hosted_checkout_url
          }),
          { headers }
        );

      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              "Erreur lors de la création du paiement.",
            error:
              error.message
          }),
          {
            status: 500,
            headers
          }
        );
      }
    }

    // =========================
    // VERIFIER PAIEMENT SUMUP
    // =========================

    if (
      url.pathname === "/check-payment" &&
      request.method === "GET"
    ) {
      const checkoutId =
        url.searchParams.get(
          "checkoutId"
        );

      if (!checkoutId) {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              "Identifiant de paiement manquant"
          }),
          {
            status: 400,
            headers
          }
        );
      }

      const sumupResponse =
        await fetch(
          `https://api.sumup.com/v0.1/checkouts/${checkoutId}`,
          {
            method: "GET",

            headers: {
              "Authorization":
                `Bearer ${env.SUMUP_API_KEY}`
            }
          }
        );

      const checkout =
        await sumupResponse.json();

      if (!sumupResponse.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              "Impossible de vérifier le paiement"
          }),
          {
            status: 502,
            headers
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          paid:
            checkout.status === "PAID",
          status:
            checkout.status
        }),
        { headers }
      );
    }

    // =========================
    // SUPPRIMER RESERVATION
    // =========================

    if (
      url.pathname === "/reservations" &&
      request.method === "DELETE"
    ) {
      const suppression =
        await request.json();

      if (
        !suppression.logement ||
        !suppression.arrivee ||
        !suppression.depart
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              "Informations manquantes."
          }),
          {
            status: 400,
            headers
          }
        );
      }

      const data =
        await env.RESERVATIONS.get(
          "reservations"
        );

      const reservations =
        data ? JSON.parse(data) : [];

      const index =
        reservations.findIndex(r =>
          r.logement ===
            suppression.logement &&
          r.arrivee <
            suppression.depart &&
          r.depart >
            suppression.arrivee
        );

      if (index === -1) {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              "Réservation introuvable."
          }),
          {
            status: 404,
            headers
          }
        );
      }

      reservations.splice(
        index,
        1
      );

      await env.RESERVATIONS.put(
        "reservations",
        JSON.stringify(reservations)
      );

      return new Response(
        JSON.stringify({
          success: true,
          message:
            "Dates débloquées."
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
        return env.ASSETS.fetch(
          request
        );
      }
    }

    return new Response(
      JSON.stringify({
        message:
          "L'Échappée Verte - API réservation"
      }),
      { headers }
    );
  }
};
