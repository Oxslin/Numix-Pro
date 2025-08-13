import { supabase, supabaseAdmin } from "./supabase"
import type { Event } from "@/types"

// Convertir de formato Supabase a formato de la aplicación
const mapEventFromSupabase = (event: any): Event => ({
  id: event.id,
  name: event.name,
  startDate: event.start_date,
  endDate: event.end_date,
  startTime: event.start_time,
  endTime: event.end_time,
  active: event.active,
  repeatDaily: event.repeat_daily,
  status: event.status,
  minNumber: event.min_number !== null ? event.min_number : 0,
  maxNumber: event.max_number !== null ? event.max_number : 99,
  excludedNumbers: event.excluded_numbers || "",
  awardedNumbers: event.first_prize
    ? {
        firstPrize: event.first_prize,
        secondPrize: event.second_prize,
        thirdPrize: event.third_prize,
        awardedAt: event.awarded_at,
      }
    : undefined,
  // Estos campos se calculan en la aplicación, no se almacenan en Supabase
  endDateTime: `${event.end_date} ${event.end_time}`,
  totalSold: 0,
  sellerTimes: 0,
  tickets: [],
  prize: 0,
  profit: 0,
})

// Convertir de formato de la aplicación a formato Supabase
const mapEventToSupabase = (event: Event) => ({
  name: event.name,
  start_date: event.startDate,
  end_date: event.endDate,
  start_time: event.startTime,
  end_time: event.endTime,
  active: event.active,
  repeat_daily: event.repeatDaily,
  status: event.status,
  min_number: event.minNumber,
  max_number: event.maxNumber,
  excluded_numbers: event.excludedNumbers,
  first_prize: event.awardedNumbers?.firstPrize,
  second_prize: event.awardedNumbers?.secondPrize,
  third_prize: event.awardedNumbers?.thirdPrize,
  awarded_at: event.awardedNumbers?.awardedAt,
})

// Obtener todos los eventos
export async function getEvents(): Promise<Event[]> {
  try {
    // Verificar la conexión a Supabase antes de realizar la consulta
    const { checkSupabaseConnection } = await import('./check-supabase')
    const connectionStatus = await checkSupabaseConnection()
    
    if (!connectionStatus.connected) {
      console.error(`Error de conexión a Supabase: ${connectionStatus.error}`)
      // Intentar obtener de localStorage como fallback
      if (typeof window !== "undefined") {
        const localEvents = localStorage.getItem("events")
        if (localEvents) {
          console.log("Usando datos de eventos desde localStorage debido a error de conexión")
          return JSON.parse(localEvents)
        }
      }
      return []
    }
    
    
    // Realizar la consulta con reintentos
    let attempts = 0
    const maxAttempts = 3
    let lastError = null
    
    while (attempts < maxAttempts) {
      try {
        const { data, error } = await supabaseAdmin  // 🔧 CAMBIO: usar supabaseAdmin
          .from("events")
          .select("*")
          .order("created_at", { ascending: false })
        
        if (error) {
          lastError = error
          console.error(`Error fetching events (intento ${attempts + 1}/${maxAttempts}):`, {
            message: error.message,
            details: error.details,
            code: error.code,
            hint: error.hint
          })
          attempts++
          if (attempts < maxAttempts) {
            // Esperar antes de reintentar (backoff exponencial)
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempts - 1)))
            continue
          }
          
          // Si llegamos aquí, se agotaron los reintentos
          // Intentar obtener de localStorage como fallback
          if (typeof window !== "undefined") {
            const localEvents = localStorage.getItem("events")
            if (localEvents) {
              console.log("Usando datos de eventos desde localStorage debido a error persistente")
              return JSON.parse(localEvents)
            }
          }
          return []
        }
        
        // Si llegamos aquí, la consulta fue exitosa
        const events = data.map(mapEventFromSupabase)
        
        // Actualizar localStorage para tener una copia local
        if (typeof window !== "undefined") {
          localStorage.setItem("events", JSON.stringify(events))
        }
        
        return events
      } catch (attemptError) {
        lastError = attemptError
        console.error(`Excepción al obtener eventos (intento ${attempts + 1}/${maxAttempts}):`, attemptError)
        attempts++
        if (attempts < maxAttempts) {
          // Esperar antes de reintentar
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempts - 1)))
        }
      }
    }
    
    // Si llegamos aquí, se agotaron los reintentos
    console.error("Error persistente al obtener eventos después de múltiples intentos:", lastError)
    
    // Intentar obtener de localStorage como último recurso
    if (typeof window !== "undefined") {
      const localEvents = localStorage.getItem("events")
      if (localEvents) {
        console.log("Usando datos de eventos desde localStorage como último recurso")
        return JSON.parse(localEvents)
      }
    }
    return []
  } catch (error) {
    console.error("Error general en getEvents:", error instanceof Error ? {
      message: error.message,
      stack: error.stack
    } : error)
    // Intentar obtener de localStorage como fallback
    if (typeof window !== "undefined") {
      const localEvents = localStorage.getItem("events")
      if (localEvents) {
        return JSON.parse(localEvents)
      }
    }
    return []
  }
}

// Crear un nuevo evento
export async function createEvent(
  event: Omit<Event, "id" | "endDateTime" | "totalSold" | "sellerTimes" | "tickets" | "prize" | "profit">,
): Promise<Event | null> {
  try {
    const supabaseEvent = {
      name: event.name,
      start_date: event.startDate,
      end_date: event.endDate,
      start_time: event.startTime,
      end_time: event.endTime,
      active: event.active ?? true,
      repeat_daily: event.repeatDaily ?? false,
      status: event.status ?? "active",
      min_number: event.minNumber ?? 0,
      max_number: event.maxNumber ?? 99,
      excluded_numbers: event.excludedNumbers ?? "",
    }

    console.log("Datos del evento a crear:", supabaseEvent) // Debug

    // Usar supabaseAdmin en lugar de supabase
    const { data, error } = await supabaseAdmin.from("events").insert([supabaseEvent]).select().single()

    if (error) {
      console.error("Error creating event:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return null
    }

    console.log("Evento creado exitosamente:", data) // Debug

    const newEvent = mapEventFromSupabase(data)

    // Actualizar localStorage
    const localEvents = JSON.parse(localStorage.getItem("events") || "[]")
    localStorage.setItem("events", JSON.stringify([...localEvents, newEvent]))

    return newEvent
  } catch (error) {
    console.error("Error in createEvent:", error)
    return null
  }
}

// Actualizar un evento existente
export async function updateEvent(event: Event): Promise<Event | null> {
  try {
    const supabaseEvent = mapEventToSupabase(event)

    // Usar supabaseAdmin en lugar de supabase
    const { data, error } = await supabaseAdmin
      .from("events")
      .update({
        ...supabaseEvent,
        status: supabaseEvent.status as "active" | "closed_awarded" | "closed_not_awarded"
      })
      .eq("id", event.id)
      .select()
      .single()

    if (error) {
      console.error("Error updating event:", error)
      return null
    }

    const updatedEvent = mapEventFromSupabase(data)

    // Actualizar localStorage
    const localEvents = JSON.parse(localStorage.getItem("events") || "[]")
    const updatedLocalEvents = localEvents.map((e: Event) => (e.id === event.id ? updatedEvent : e))
    localStorage.setItem("events", JSON.stringify(updatedLocalEvents))

    return updatedEvent
  } catch (error) {
    console.error("Error in updateEvent:", error)
    return null
  }
}

// Eliminar un evento
export async function deleteEvent(id: string): Promise<boolean> {
  try {
    // Usar supabaseAdmin en lugar de supabase
    const { error } = await supabaseAdmin.from("events").delete().eq("id", id)

    if (error) {
      console.error("Error deleting event:", error)
      return false
    }

    // Actualizar localStorage
    const localEvents = JSON.parse(localStorage.getItem("events") || "[]")
    const filteredEvents = localEvents.filter((e: Event) => e.id !== id)
    localStorage.setItem("events", JSON.stringify(filteredEvents))

    return true
  } catch (error) {
    console.error("Error in deleteEvent:", error)
    return false
  }
}

// Premiar un evento
export async function awardEvent(
  id: string,
  numbers: { firstPrize: string; secondPrize: string; thirdPrize: string },
): Promise<Event | null> {
  try {
    const now = new Date().toISOString()

    // Usar supabaseAdmin en lugar de supabase
    const { data, error } = await supabaseAdmin
      .from("events")
      .update({
        status: "closed_awarded",
        first_prize: numbers.firstPrize,
        second_prize: numbers.secondPrize,
        third_prize: numbers.thirdPrize,
        awarded_at: now,
      })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("Error awarding event:", error)
      return null
    }

    const updatedEvent = mapEventFromSupabase(data)

    // Actualizar localStorage
    const localEvents = JSON.parse(localStorage.getItem("events") || "[]")
    const updatedLocalEvents = localEvents.map((e: Event) => (e.id === id ? updatedEvent : e))
    localStorage.setItem("events", JSON.stringify(updatedLocalEvents))

    return updatedEvent
  } catch (error) {
    console.error("Error in awardEvent:", error)
    return null
  }
}

// Función para cerrar automáticamente eventos expirados
export async function autoCloseExpiredEvents(): Promise<void> {
  try {
    const now = new Date()
    const currentDate = now.toISOString().split('T')[0] // YYYY-MM-DD
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5) // HH:MM
    
    // Buscar eventos activos que ya han expirado
    const { data: expiredEvents, error } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("status", "active")
      .or(`end_date.lt.${currentDate},and(end_date.eq.${currentDate},end_time.lte.${currentTime})`)
    
    if (error) {
      console.error("Error fetching expired events:", error)
      return
    }
    
    if (!expiredEvents || expiredEvents.length === 0) {
      return
    }
    
    // Actualizar el estado de todos los eventos expirados
    const { error: updateError } = await supabaseAdmin
      .from("events")
      .update({ status: "closed_not_awarded" })
      .in("id", expiredEvents.map(event => event.id))
    
    if (updateError) {
      console.error("Error updating expired events:", updateError)
      return
    }
    
    console.log(`Se cerraron automáticamente ${expiredEvents.length} eventos expirados`)
  } catch (error) {
    console.error("Error in autoCloseExpiredEvents:", error)
  }
}

// Suscribirse a cambios en eventos (tiempo real)
export async function subscribeToEvents(callback: (events: Event[]) => void): Promise<() => void> {
  // Verificar si estamos en el navegador
  if (typeof window === "undefined") {
    console.log("No se puede suscribir a eventos en el servidor")
    return () => {} // Retornar función vacía en el servidor
  }

  try {
    // Crear un canal con un ID único para evitar conflictos
    const channelId = `events-changes-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    console.log(`Creando canal de suscripción: ${channelId}`)

    // Verificar si ya existe una suscripción activa y eliminarla
    const existingChannels = supabase.getChannels()
    existingChannels.forEach(channel => {
      if (channel.topic.startsWith('realtime:events-changes-')) {
        console.log(`Eliminando canal existente: ${channel.topic}`)
        try {
          supabase.removeChannel(channel)
        } catch (removeError) {
          console.error(`Error al eliminar canal existente: ${removeError}`)
          // Continuar con la operación incluso si hay error al eliminar
        }
      }
    })
    
    // Esperar un momento después de eliminar canales para evitar conflictos
    await new Promise(resolve => setTimeout(resolve, 500))

    // Contador de reconexiones para implementar backoff exponencial
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 15; // Máximo número de intentos antes de rendirse
    
    // Crear un nuevo canal con configuración mejorada
    const channel = supabase.channel(channelId, {
      config: {
        broadcast: { self: true },
        presence: { key: "" },
        // Aumentar el tiempo de espera para evitar cierres prematuros
        timeout: 300000, // 300 segundos (5 minutos)
        retryIntervalMs: 5000, // 5 segundos entre reintentos (más rápido)
        retryMaxCount: 10 // Aumentar a 10 reintentos para mayor persistencia
      },
    })

    // Variable para rastrear si el canal está activo
    let isChannelActive = true;
    // Variable para rastrear si estamos procesando un evento
    let isProcessingEvent = false;

    // Configurar la suscripción con manejo de errores mejorado
    channel
      .on(
        "postgres_changes",
        {
          event: "*", // Escuchar todos los eventos (INSERT, UPDATE, DELETE)
          schema: "public",
          table: "events",
        },
        async (payload) => {
          // Evitar procesamiento si el canal ya no está activo
          if (!isChannelActive) return;
          
          // Implementar un sistema de cola simple para eventos concurrentes
          if (isProcessingEvent) {
            console.log("Ya se está procesando un evento, encolando...");
            // Esperar a que termine el procesamiento actual antes de continuar
            let waitCount = 0;
            const maxWaits = 10; // Máximo número de intentos de espera
            
            while (isProcessingEvent && waitCount < maxWaits) {
              // Esperar antes de verificar nuevamente
              await new Promise(resolve => setTimeout(resolve, 300));
              waitCount++;
              
              // Verificar si el canal sigue activo después de cada espera
              if (!isChannelActive) return;
            }
            
            // Si después de esperar sigue procesando, salir para evitar bloqueo
            if (isProcessingEvent) {
              console.log("Evento descartado después de esperar demasiado tiempo");
              return;
            }
          }
          
          try {
            isProcessingEvent = true;
            console.log("Cambio detectado en events:", payload);
            
            // Obtener eventos de forma segura
            const events = await getEvents();
            if (isChannelActive) {
              // Usar try/catch específico para el callback
              try {
                callback(events);
              } catch (callbackError) {
                console.error("Error en callback de eventos:", callbackError);
              }
            }
          } catch (error) {
            console.error("Error al procesar cambio en events:", error);
          } finally {
            isProcessingEvent = false;
          }
        },
      )
      .subscribe(async (status, error) => {
        console.log(`Estado de suscripción (${channelId}):`, status)

        if (status === 'SUBSCRIBED') {
          // Resetear contador de intentos cuando se conecta exitosamente
          reconnectAttempts = 0;
          console.log('Suscripción establecida correctamente, actualizando datos...');
          try {
            const events = await getEvents();
            callback(events);
          } catch (dataError) {
            console.error('Error al obtener datos después de suscripción:', dataError);
          }
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`Error en la suscripción (${channelId}):`, error);
          
          // Implementar backoff exponencial con jitter para evitar reconexiones simultáneas
          if (isChannelActive && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            // Calcular tiempo de espera con backoff exponencial y jitter
            const baseDelay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000); // Máximo 30 segundos
            const jitter = Math.floor(Math.random() * 1000); // Añadir hasta 1 segundo de jitter
            const backoffTime = baseDelay + jitter;
            
            console.log(`Intento de reconexión ${reconnectAttempts}/${maxReconnectAttempts} en ${backoffTime}ms...`);
            
            // Esperar antes de intentar reconectar
            await new Promise(resolve => setTimeout(resolve, backoffTime));
            
            if (isChannelActive) {
              try {
                // Intentar reconectar el canal
                await channel.subscribe();
                console.log('Reconexión exitosa');
              } catch (reconnectError) {
                console.error('Error al reconectar:', reconnectError);
                // Continuar con el sistema de reintentos automáticos
              }
            }
          } else if (reconnectAttempts >= maxReconnectAttempts) {
            console.log(`Se alcanzó el máximo de intentos de reconexión (${maxReconnectAttempts}). Deteniendo reintentos.`);
            isChannelActive = false;
          }
        } else if (error) {
          console.error(`Error inesperado en la suscripción (${channelId}):`, error);
        }
      })

    // Devolver función para cancelar la suscripción
    return () => {
      console.log(`Cancelando suscripción al canal ${channelId}`)
      isChannelActive = false;
      try {
        supabase.removeChannel(channel)
      } catch (cleanupError) {
        console.error("Error al limpiar canal:", cleanupError)
        // Continuar incluso si hay error al limpiar
      }
    }
  } catch (error) {
    console.error("Error al crear suscripción a events:", error)
    // Retornar una función vacía en caso de error
    return () => {
      console.log("Limpieza de suscripción fallida")
    }
  }
}

