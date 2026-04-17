import admin from "firebase-admin";

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

export const updateGlobalEnvironmentalContext = async () => {
  const db = admin.firestore();
  const contextRef = db.collection('global_context').doc('environment');

  try {
    const lat = -33.4489; // Default Santiago
    const lon = -70.6693;

    // 1. Fetch Weather
    let weatherData = null;
    if (OPENWEATHER_API_KEY) {
      const weatherRes = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`
      );
      if (weatherRes.ok) {
        const data = await weatherRes.json();
        weatherData = {
          temp: Math.round(data.main.temp),
          condition: data.weather[0]?.description || 'Despejado',
          humidity: data.main.humidity,
          windSpeed: data.wind.speed * 3.6,
          location: data.name,
          timestamp: Date.now()
        };
      }
    }

    // 2. Fetch Seismic
    let seismicData = null;
    const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const seismicRes = await fetch(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=500&starttime=${startTime}&minmagnitude=3.0&limit=1&orderby=magnitude`
    );
    if (seismicRes.ok) {
      const data = await seismicRes.json();
      if (data.features && data.features.length > 0) {
        const quake = data.features[0];
        const mag = quake.properties.mag;
        let alertLevel = 'green';
        if (mag >= 6.0) alertLevel = 'red';
        else if (mag >= 5.0) alertLevel = 'orange';
        else if (mag >= 4.0) alertLevel = 'yellow';

        seismicData = {
          magnitude: mag,
          location: quake.properties.place,
          time: quake.properties.time,
          alertLevel
        };
      }
    }

    // 3. Update Firestore
    await contextRef.set({
      weather: weatherData,
      seismic: seismicData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log("[EnvironmentBackend] Global environmental context updated.");
  } catch (error) {
    console.error("[EnvironmentBackend] Error updating context:", error);
  }
};
