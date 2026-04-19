import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  es: {
    translation: {
      "app": {
        "name": "Praeventio Guard",
        "tagline": "El Guardián de tu Seguridad"
      },
      "nav": {
        "dashboard": "Dashboard",
        "emergency": "Emergencia",
        "risk_network": "Red de Riesgo",
        "training": "Capacitación",
        "safety_feed": "Muro Social",
        "analytics": "Analíticas",
        "settings": "Ajustes",
        "command_center": "Centro de Mando",
        "projects": "Proyectos",
        "reportability": "Reportabilidad",
        "ai_group": "Inteligencia Artificial",
        "ai_hub": "AI Hub",
        "zettelkasten": "Zettelkasten",
        "academic_processor": "Procesador Académico",
        "ocr_motor": "Motor OCR",
        "ops_group": "Módulos Operativos",
        "ops_mgmt": "Gestión Operativa",
        "health": "Salud y Bienestar",
        "emergencies": "Entorno y Emergencias",
        "compliance": "Cumplimiento Legal",
        "culture": "Talento y Cultura",
        "settings_group": "Configuración",
        "profile": "Mi Perfil",
        "pricing": "Planes y Facturación",
        "help": "Ayuda y Soporte",
        "survival_mode": "Modo Supervivencia",
        "theme_light": "Modo Claro",
        "theme_dark": "Modo Oscuro",
        "logout": "Cerrar Sesión"
      },
      "dashboard": {
        "welcome": "Hola, {{name}}",
        "checkin_status": "Estado de Check-in",
        "safe": "Seguro",
        "danger": "En Peligro",
        "last_morning_checkin": "Último Check-in Matutino"
      },
      "emergency": {
        "title": "Centro de Control de Emergencias",
        "crisis_mode": "Modo Crisis",
        "sos": "Activar SOS",
        "man_down_detection": "Detección de Hombre Caído",
        "checkin": "Check-in de Seguridad"
      },
      "risk_network": {
        "title": "Red Neuronal de Riesgos",
        "analyze": "Analizar Red",
        "predict": "Predecir Accidentes",
        "explorer": "Explorador de Nodos"
      },
      "common": {
        "loading": "Cargando...",
        "save": "Guardar",
        "cancel": "Cancelar",
        "error": "Error",
        "success": "Éxito"
      }
    }
  },
  en: {
    translation: {
      "app": {
        "name": "Praeventio Guard",
        "tagline": "Your Safety Guardian"
      },
      "nav": {
        "dashboard": "Dashboard",
        "emergency": "Emergency",
        "risk_network": "Risk Network",
        "training": "Training",
        "safety_feed": "Safety Feed",
        "analytics": "Analytics",
        "settings": "Settings",
        "command_center": "Command Center",
        "projects": "Projects",
        "reportability": "Reporting",
        "ai_group": "Artificial Intelligence",
        "ai_hub": "AI Hub",
        "zettelkasten": "Zettelkasten",
        "academic_processor": "Academic Processor",
        "ocr_motor": "OCR Motor",
        "ops_group": "Operations",
        "ops_mgmt": "Ops Management",
        "health": "Health & Wellness",
        "emergencies": "Environment & Emergencies",
        "compliance": "Compliance",
        "culture": "Talent & Culture",
        "settings_group": "Configuration",
        "profile": "Profile",
        "pricing": "Pricing",
        "help": "Help & Support",
        "survival_mode": "Survival Mode",
        "theme_light": "Light Mode",
        "theme_dark": "Dark Mode",
        "logout": "Logout"
      },
      "dashboard": {
        "welcome": "Hello, {{name}}",
        "checkin_status": "Check-in Status",
        "safe": "Safe",
        "danger": "In Danger",
        "last_morning_checkin": "Last Morning Check-in"
      },
      "emergency": {
        "title": "Emergency Control Center",
        "crisis_mode": "Crisis Mode",
        "sos": "Activate SOS",
        "man_down_detection": "Man-Down Detection",
        "checkin": "Safety Check-in"
      },
      "risk_network": {
        "title": "Neural Risk Network",
        "analyze": "Analyze Network",
        "predict": "Predict Accidents",
        "explorer": "Node Explorer"
      },
      "common": {
        "loading": "Loading...",
        "save": "Save",
        "cancel": "Cancel",
        "error": "Error",
        "success": "Success"
      }
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'es',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['querystring', 'cookie', 'localStorage', 'navigator'],
      caches: ['localStorage', 'cookie'],
    }
  });

export default i18n;
