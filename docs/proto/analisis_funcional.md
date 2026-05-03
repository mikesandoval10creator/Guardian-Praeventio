> Documento recuperado del prototipo `Guardian-Praeventio-f-irebaseversion` y sanitizado al 2026-05-03. Conservado por valor histórico y de referencia arquitectónica.

# Análisis Funcional del Código Fuente de Praeventio

## Propósito de este Documento

Este documento es un mapa vivo de la verdad del sistema, generado a través de un análisis exhaustivo y sistemático del código fuente. Su objetivo es proporcionar una comprensión clara, precisa y procesable de la arquitectura actual, las capacidades y las regresiones del proyecto. Originalmente concebido en 2025 como resultado de la Fase 1: Auditoría y Mapeo.

---

## Estructura General del Proyecto (Directorio `src`)

El proyecto está organizado en una estructura de componentes y lógica de negocio, con un claro enfoque en la modularidad.

### **1. Núcleo de la Aplicación (`App.tsx`, `main.tsx`)**

*   **Punto de Entrada:** `main.tsx` inicializa la aplicación y renderiza el componente principal `App.tsx`.
*   **Enrutamiento:** Utiliza `react-router-dom` para gestionar la navegación entre las diferentes páginas.
*   **Gestión de Estado Global:** No se detecta un sistema de gestión de estado global complejo como Redux. La gestión de estado se localiza en componentes o se distribuye vía `Context`.
*   **Proveedores de Contexto:** `App.tsx` se envuelve en múltiples proveedores (`ThemeProvider`, `AuthContext`), evidencia de un uso extensivo del patrón de contexto de React para compartir estado.

### **2. Lógica de Negocio y Servicios (`lib`, `hooks`, `services`)**

*   **`lib`:** Contiene la lógica de negocio principal, configuración de Firebase/Firestore (current stack) (`firebase-config.ts`), y utilidades generales. Es el corazón de la lógica desacoplada de la UI.
*   **`hooks`:** Abundan los custom hooks (`use...`), lo que sugiere una estrategia para encapsular y reutilizar lógica con estado en los componentes, como `useAuth`, `useFirestore`, etc.
*   **`services`:** Contiene lógica para interactuar con sistemas externos o bases de datos locales.

### **3. Interfaz de Usuario (`components`, `pages`)**

*   **`components`:** Directorio masivo con subdirectorios que agrupan componentes por funcionalidad (ej. `admin`, `ai`, `dashboard`, `epp`, `ergo`). La UI es altamente componentizada.
*   **`pages`:** Define las páginas principales de la aplicación, que a su vez componen los componentes de la carpeta `components`.

---

## Auditoría de Componentes Clave

### **1. `lib/firebase-config.ts`**

*   **Descripción:** Configura y exporta las instancias de los servicios de Firebase/Firestore (current stack) (Auth, Firestore, Functions, Analytics, Performance).
*   **Rol:** Fuente única de verdad para la configuración de Firebase, asegurando consistencia en todo el proyecto.
*   **Estado:** CORRECTO. Centralizado y bien implementado.

### **2. `lib/cloud-functions-client.ts`**

*   **Descripción:** Proporciona un cliente tipado para invocar las Cloud Functions de Firebase/Firestore (current stack).
*   **Rol:** Actúa como un SDK interno, permitiendo que el frontend llame a las funciones del backend de manera segura y con conocimiento de los tipos de datos esperados.
*   **Estado:** CORRECTO. Pieza clave para la comunicación segura entre frontend y backend.

### **3. `lib/ai-computer-vision.ts`**

*   **Descripción:** Módulo destinado a interactuar con una API de visión por computadora.
*   **Estado:** `[FUNCIONALIDAD INCOMPLETA]` El módulo existe, pero no se encuentra ninguna integración activa. Es una capacidad latente.

### **4. Subsistema de Seguridad (`security-manager.ts`)**

`[HALLAZGO CRÍTICO - REGRESIÓN ARQUITECTÓNICA]`

*   **Descripción:** Un módulo de seguridad de alta capacidad (biometría, cifrado, auditorías) que se encuentra infrautilizado, operando solo como proveedor de estado de autenticación básico.
*   **Regresión:** El código antiguo manejaba la autenticación directamente en el backend (Cloud Functions), validando cada llamada al Orquestador. El `security-manager` actual, aunque potente, no está integrado con esta lógica de backend.

---

## Conclusión de la Fase de Análisis: El "Mapa" Está Completo

La auditoría del código fuente revela una arquitectura de dos tiempos: un sistema antiguo de gran poder y un sistema nuevo en proceso de "rescate" y reconstrucción.

### **La Arquitectura del Sistema Antiguo (Backend) — patrón "Portal → Sentidos → Mente"**

El núcleo de la funcionalidad reside en las Cloud Functions del respaldo, diseñadas con una arquitectura clara y potente:

1.  **El Portal (`praeventio.ts`):** Punto de entrada unificado que aísla la lógica principal y exporta las funciones clave del sistema, actuando como capa anticorrupción.

2.  **Los Sentidos (`praeventio-orchestrator.ts`):** Esta función actúa como el "orquestador" o los "sentidos" del sistema. No procesa la petición del usuario directamente. Su única misión es **enriquecer el contexto** de la petición, recopilando datos del mundo real en tiempo real a través de adaptadores aislados:
    *   **Adaptador Meteorológico:** Se conecta a la API de OpenWeatherMap. Implementa una **estrategia de resiliencia clave**, devolviendo datos simulados si la API real falla o no está configurada. Garantiza que el sistema nunca pierda por completo su "sentido" del clima.
    *   **Adaptador Sísmico:** Se conecta a un endpoint público del USGS. Si la API falla, devuelve `null`, lo que indica menor robustez en este sentido.

3.  **La Mente (El Gran Maestro via `/api/ask-guardian`):** Función cognitiva central. Recibe el contexto enriquecido del orquestador y lo utiliza para alimentar un prompt altamente específico para un modelo de IA generativa.
    *   **Misión de la IA:** Actuar como experto en seguridad industrial con 30 años de experiencia.
    *   **Resultado Exigido:** La IA debe devolver **únicamente un objeto JSON** con estructura estricta: análisis de causa raíz, riesgos identificados (con severidad y probabilidad) y plan de acción con medidas correctivas y preventivas.

Esta arquitectura revela un sistema diseñado para que la IA nunca opere en el vacío, sino con conciencia constante del entorno físico del usuario, permitiéndole generar análisis de riesgo altamente relevantes y contextualizados.

Este mapa es la fuente de verdad histórica para guiar la fase de implementación y fusión actual.
