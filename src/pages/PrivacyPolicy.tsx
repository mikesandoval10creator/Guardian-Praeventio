import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-12">

        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm font-bold mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Política de Privacidad</h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Guardian Praeventio · praeventio.net</p>
          </div>
        </div>

        <p className="text-zinc-400 text-sm mb-8">
          Última actualización: {new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>

        <div className="space-y-8 text-zinc-300 text-sm leading-relaxed">

          <section>
            <h2 className="text-white font-black text-lg mb-3">1. Responsable del Tratamiento</h2>
            <p>
              Guardian Praeventio ("nosotros", "la aplicación") es una plataforma de prevención de riesgos laborales
              desarrollada y operada a través del dominio <strong className="text-white">praeventio.net</strong>.
              Para consultas sobre privacidad, puede contactarnos en: <strong className="text-emerald-400">privacidad@praeventio.net</strong>
            </p>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">2. Datos que Recopilamos</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li><strong className="text-white">Datos de cuenta:</strong> nombre, correo electrónico y foto de perfil obtenidos mediante Google Sign-In.</li>
              <li><strong className="text-white">Datos del proyecto:</strong> información sobre su empresa, trabajadores, incidentes, auditorías y capacitaciones que usted registra voluntariamente.</li>
              <li><strong className="text-white">Ubicación:</strong> coordenadas GPS en situaciones de emergencia activadas por el usuario o para el seguimiento de geovallas configuradas por el administrador del proyecto.</li>
              <li><strong className="text-white">Sensores del dispositivo:</strong> acelerómetro (solo para detección de caídas, activado explícitamente).</li>
              <li><strong className="text-white">Notificaciones push:</strong> token del dispositivo para envío de alertas de emergencia y capacitaciones.</li>
              <li><strong className="text-white">Datos de suscripción:</strong> plan activo y token de compra de Google Play Billing. No almacenamos datos de tarjetas de crédito.</li>
              <li><strong className="text-white">Datos de uso:</strong> eventos de telemetría anónimos para mejorar la aplicación (funciones utilizadas, errores).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">3. Finalidad del Tratamiento</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>Proveer las funcionalidades de prevención de riesgos, emergencias y cumplimiento normativo.</li>
              <li>Gestionar la identidad y autenticación del usuario.</li>
              <li>Enviar alertas de emergencia y notificaciones de capacitación.</li>
              <li>Verificar y gestionar suscripciones a través de Google Play Billing.</li>
              <li>Cumplir con la normativa chilena: DS 54, DS 40, Ley 16.744, ISO 45001.</li>
              <li>Mejorar la plataforma mediante análisis de uso agregado y anónimo.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">4. Base Legal</h2>
            <p>
              El tratamiento de datos se realiza conforme a la <strong className="text-white">Ley N° 19.628</strong> sobre
              Protección de la Vida Privada de Chile y sus modificaciones. La base legal es el consentimiento del
              usuario al aceptar estos términos y la ejecución del contrato de servicio.
            </p>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">5. Compartición de Datos</h2>
            <p className="mb-3">No vendemos ni comercializamos sus datos personales. Los datos pueden ser compartidos exclusivamente con:</p>
            <ul className="space-y-2 list-disc list-inside">
              <li><strong className="text-white">Google Firebase:</strong> almacenamiento, autenticación y notificaciones push (política: firebase.google.com/support/privacy).</li>
              <li><strong className="text-white">Google Gemini AI:</strong> procesamiento de consultas de IA. Solo se envían los textos de las consultas, nunca datos personales identificables sin su consentimiento.</li>
              <li><strong className="text-white">Google Play Billing:</strong> verificación de compras en la plataforma Android.</li>
              <li><strong className="text-white">Resend:</strong> envío de correos electrónicos de invitación a proyectos.</li>
              <li><strong className="text-white">Miembros de su proyecto:</strong> dentro del proyecto, los supervisores y administradores pueden ver datos del equipo conforme a los roles asignados.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">6. Retención de Datos</h2>
            <p>
              Los datos del proyecto se conservan mientras la cuenta esté activa. Al eliminar su cuenta,
              los datos personales se eliminan en un plazo máximo de 30 días. Los registros de auditoría
              son inmutables por requisito de la normativa laboral chilena y se conservan durante 5 años.
            </p>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">7. Permisos de la Aplicación Android</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li><strong className="text-white">Ubicación (ACCESS_FINE_LOCATION):</strong> solo en emergencias activas o geovallas configuradas.</li>
              <li><strong className="text-white">Cámara (CAMERA):</strong> escaneo de códigos QR para control de acceso a sitios.</li>
              <li><strong className="text-white">Internet (INTERNET):</strong> sincronización de datos con la nube.</li>
              <li><strong className="text-white">Notificaciones (POST_NOTIFICATIONS):</strong> alertas de emergencia y recordatorios de capacitación.</li>
              <li><strong className="text-white">Bluetooth (BLUETOOTH_SCAN):</strong> integración opcional con wearables de seguridad.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">8. Sus Derechos</h2>
            <p className="mb-3">Conforme a la Ley 19.628, usted tiene derecho a:</p>
            <ul className="space-y-2 list-disc list-inside">
              <li>Acceder a sus datos personales.</li>
              <li>Rectificar datos inexactos.</li>
              <li>Solicitar la eliminación de su cuenta y datos asociados.</li>
              <li>Oponerse al tratamiento de sus datos.</li>
              <li>Portar sus datos en formato estructurado.</li>
            </ul>
            <p className="mt-3">
              Para ejercer estos derechos, escríbanos a <strong className="text-emerald-400">privacidad@praeventio.net</strong>.
              Responderemos en un plazo máximo de 15 días hábiles.
            </p>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">9. Seguridad</h2>
            <p>
              Todos los datos se transmiten mediante HTTPS/TLS. El almacenamiento en Firebase utiliza
              cifrado en reposo. Las reglas de seguridad de Firestore aplican el principio de mínimo
              privilegio: cada usuario solo accede a los datos de sus propios proyectos.
            </p>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">10. Cambios a esta Política</h2>
            <p>
              Notificaremos cambios significativos mediante un aviso en la aplicación con al menos 15 días
              de anticipación. El uso continuado de la aplicación tras la fecha de vigencia implica la
              aceptación de la política actualizada.
            </p>
          </section>

          <section>
            <h2 className="text-white font-black text-lg mb-3">11. Contacto</h2>
            <p>
              Guardian Praeventio · <strong className="text-emerald-400">privacidad@praeventio.net</strong> · praeventio.net
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-white/5 text-center text-xs text-zinc-600 font-bold uppercase tracking-widest">
          © {new Date().getFullYear()} Guardian Praeventio · Chile · Todos los derechos reservados
        </div>

      </div>
    </div>
  );
}
