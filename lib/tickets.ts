import { supabase, supabaseAdmin } from "./supabase"
import type { Ticket } from "@/types"
import { generateUUID } from "./uuid-utils"
import { checkNumberAvailability, incrementNumberSold, decrementNumberSold, getNumberLimit } from "./number-limits"

// === CACHE Y OPTIMIZACIONES GLOBALES ===
interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class OptimizedCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private readonly defaultTTL: number

  constructor(defaultTTL: number = 5000) {
    this.defaultTTL = defaultTTL
  }

  set(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    })
  }

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
      }
    }
  }
}

// Caches optimizados
const ticketCache = new OptimizedCache<any>(5000) // 5 segundos
const duplicateCache = new OptimizedCache<boolean>(10000) // 10 segundos
const availabilityCache = new OptimizedCache<any>(3000) // 3 segundos

// Limpieza automática de cache cada 30 segundos
if (typeof window !== "undefined") {
  setInterval(() => {
    ticketCache.cleanup()
    duplicateCache.cleanup()
    availabilityCache.cleanup()
  }, 30000)
}

// === UTILIDADES OPTIMIZADAS ===
function safeGetItem(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// === MAPPERS OPTIMIZADOS ===
export const mapTicketFromSupabase = (ticket: any): Ticket => ({
  id: ticket.id,
  clientName: ticket.client_name,
  amount: ticket.amount,
  numbers: ticket.numbers || "",
  vendorEmail: ticket.vendor_email,
  rows: Array.isArray(ticket.rows) ? ticket.rows : JSON.parse(ticket.rows || "[]"),
})

const mapTicketToSupabase = (ticket: Ticket, eventId: string) => ({
  id: ticket.id,
  event_id: eventId,
  client_name: ticket.clientName,
  amount: ticket.amount,
  numbers: ticket.numbers,
  vendor_email: ticket.vendorEmail || "unknown",
  rows: ticket.rows,
})

// === FUNCIÓN DE DUPLICADOS OPTIMIZADA ===
export async function isTicketDuplicate(
  ticket: Omit<Ticket, "id">,
  eventId: string
): Promise<boolean> {
  const cacheKey = `${eventId}-${ticket.clientName}-${ticket.amount}-${ticket.numbers}`
  
  // Verificar cache
  const cached = duplicateCache.get(cacheKey)
  if (cached !== null) {
    console.log('📦 Cache hit - verificación de duplicados')
    return cached
  }

  try {
    const { data, error } = await supabase
      .from("tickets")
      .select("id")
      .eq("event_id", eventId)
      .eq("client_name", ticket.clientName)
      .eq("amount", ticket.amount)
      .eq("numbers", ticket.numbers || "")
      .limit(1) // Optimización: solo necesitamos saber si existe

    if (error) {
      console.error("Error verificando duplicados:", error)
      return false
    }

    const isDuplicate = (data?.length || 0) > 0
    
    // Guardar en cache
    duplicateCache.set(cacheKey, isDuplicate)
    
    return isDuplicate
  } catch (error) {
    console.error("Error en verificación de duplicados:", error)
    return false
  }
}

// === FUNCIÓN GET TICKETS OPTIMIZADA Y CORREGIDA ===
export async function getTickets(eventId: string, signal?: AbortSignal): Promise<Ticket[]> {
  const currentVendorEmail = safeGetItem("currentVendorEmail")
  if (!currentVendorEmail) {
    console.error("No se encontró email de vendedor actual")
    return []
  }

  const cacheKey = `tickets-${eventId}-${currentVendorEmail}`
  const localStorageKey = `tickets-${eventId}-${currentVendorEmail}`
  
  // Obtener tickets de localStorage como fallback
  const fallbackTickets: Ticket[] = (() => {
    try {
      const stored = safeGetItem(localStorageKey)
      return stored ? JSON.parse(stored) : []
    } catch (error) {
      console.error('Error parsing localStorage tickets:', error)
      return []
    }
  })()
  
  // Verificar cache
  const cached = ticketCache.get(cacheKey)
  if (cached) {
    console.log('📦 Cache hit - obtención de tickets para vendedor:', currentVendorEmail)
    return cached
  }

  try {
    if (signal?.aborted) {
      return fallbackTickets
    }
    
    console.log('🔍 Obteniendo tickets para vendedor:', currentVendorEmail, 'en evento:', eventId)
    
    // 🔧 CAMBIO: Usar supabaseAdmin en lugar de supabase
    const { data, error } = await supabaseAdmin
      .from("tickets")
      .select("*")
      .eq("event_id", eventId)
      .eq("vendor_email", currentVendorEmail)
      .order("created_at", { ascending: false })
      .abortSignal(signal)

    if (error) {
      console.error("Error obteniendo tickets de Supabase:", error)
      console.log('📱 Usando tickets de localStorage como fallback:', fallbackTickets.length)
      if (fallbackTickets.length > 0) {
        ticketCache.set(cacheKey, fallbackTickets)
      }
      return fallbackTickets
    }

    const tickets = data?.map(mapTicketFromSupabase) || []

    console.log(`✅ Tickets obtenidos de Supabase: ${tickets.length} para vendedor ${currentVendorEmail}`)

    // CORREGIDO: Siempre usar datos de Supabase como fuente de verdad
    const finalTickets = tickets
    
    // Guardar en cache y localStorage
    ticketCache.set(cacheKey, finalTickets)
    localStorage.setItem(localStorageKey, JSON.stringify(finalTickets))
    
    return finalTickets
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return fallbackTickets
    }
    console.error("Error en getTickets:", error)
    
    console.log('📱 Usando tickets de localStorage como fallback (excepción):', fallbackTickets.length)
    if (fallbackTickets.length > 0) {
      ticketCache.set(cacheKey, fallbackTickets)
    }
    
    return fallbackTickets
  }
}

// === FUNCIÓN CREATETICKETBATCH ULTRA-OPTIMIZADA ===
export async function createTicketBatch(
  ticket: Omit<Ticket, "id">,
  eventId: string,
  signal?: AbortSignal
): Promise<Ticket | null | { success: false, message: string, status: string, numberInfo?: { number: string, remaining: number, requested: number } }> {
  try {
    // AGREGAR: Inicializar startTime para medir rendimiento
    const startTime = performance.now()
    
    const currentVendorEmail = safeGetItem("currentVendorEmail")
    if (!currentVendorEmail) {
      throw new Error("No se encontró email de vendedor actual")
    }

    // PASO 1: Consolidación instantánea optimizada
    const numbersMap = new Map<string, number>()
    let totalNumbers = 0
    
    for (const row of ticket.rows) {
      if (row.actions && row.times) {
        const times = parseInt(row.times, 10)
        if (times > 0) {
          numbersMap.set(row.actions, (numbersMap.get(row.actions) || 0) + times)
          totalNumbers += times
        }
      }
    }

    if (numbersMap.size === 0) {
      return { success: false, status: "error", message: "No hay números válidos" }
    }

    // PASO 2: Preparar datos optimizados
    const numbersData = Array.from(numbersMap.entries()).map(([number_range, increment_amount]) => ({
      number_range,
      increment_amount
    }))

    // PASO 3: Crear ticket completo
    const ticketId = generateUUID()
    const completeTicket: Ticket = {
      ...ticket,
      id: ticketId,
      vendorEmail: currentVendorEmail,
    }

    // PASO 4: TRANSACCIÓN ATÓMICA ULTRA-RÁPIDA
    console.log(`🚀 Creando ticket para vendedor: ${currentVendorEmail} con ${numbersMap.size} números únicos (${totalNumbers} total)`)
    
    const { data, error } = await supabaseAdmin.rpc('numix_create_ticket', {
      p_event_id: eventId,
      p_ticket_data: mapTicketToSupabase(completeTicket, eventId),
      p_numbers_data: numbersData
    })

    if (error) {
      console.error("Error en transacción atómica:", error)
      
      if (error.message && error.message.includes('Límite excedido')) {
        const match = error.message.match(/número (\w+)/)
        const number = match ? match[1] : 'desconocido'
        return {
          success: false,
          status: "warning",
          message: error.message,
          numberInfo: { number, remaining: 0, requested: numbersMap.get(number) || 0 }
        }
      }
      
      return { 
        success: false, 
        status: "error", 
        message: error.message || "Error procesando ticket" 
      }
    }

    // Verificar que la función retornó éxito
    if (!data || !data.success) {
      return { 
        success: false, 
        status: "error", 
        message: data?.error || "Error en la respuesta del servidor" 
      }
    }
    
    // Extraer el ticket del objeto de respuesta
    const result = mapTicketFromSupabase(data.ticket)
    const endTime = performance.now()
    
    console.log(`🎯 TICKET CREADO EXITOSAMENTE: ${(endTime - startTime).toFixed(2)}ms | Vendedor: ${currentVendorEmail}`)
    
    // En createTicketBatch (línea 320-325)
    // AGREGAR: Actualizar localStorage después de crear el ticket
    const localStorageKey = `tickets-${eventId}-${currentVendorEmail}`
    const existingTickets = JSON.parse(localStorage.getItem(localStorageKey) || "[]")
    existingTickets.push(result)
    localStorage.setItem(localStorageKey, JSON.stringify(existingTickets))
    
    // INVALIDAR CACHE ESPECÍFICO DEL VENDEDOR
    const cacheKey = `tickets-${eventId}-${currentVendorEmail}`
    ticketCache.delete(cacheKey) // Solo eliminar el caché específico, no todo
    
    return result
  } catch (error) {
    console.error("Error in createTicketBatch:", error)
    return { success: false, status: "error", message: "Error inesperado" }
  }
}

// === FUNCIÓN CREATETICKET OPTIMIZADA (COMPATIBILIDAD) ===
export async function createTicket(
  ticket: Omit<Ticket, "id">,
  eventId: string,
  signal?: AbortSignal
): Promise<Ticket | null | { success: false, message: string, status: string, numberInfo?: { number: string, remaining: number, requested: number } }> {
  return createTicketBatch(ticket, eventId, signal)
}

// === FUNCIÓN UPDATE OPTIMIZADA ===
export async function updateTicket(
  ticket: Ticket,
  eventId: string,
  vendorEmail: string,
  signal?: AbortSignal
): Promise<Ticket | null | { success: false, message: string, status: string, numberInfo?: { number: string, remaining: number, requested: number } }> {
  try {
    // ✅ Logging para debug
    console.log("🔍 updateTicket - Datos recibidos:", {
      ticketId: ticket.id,
      ticketVendorEmail: ticket.vendorEmail,
      paramVendorEmail: vendorEmail,
      eventId
    })
    
    if (!vendorEmail) {
      console.error("❌ No se proporcionó email de vendedor")
      throw new Error("No se proporcionó email de vendedor")
    }

    if (ticket.vendorEmail && ticket.vendorEmail !== vendorEmail) {
      console.error("❌ Intento de modificar ticket de otro vendedor:", {
        ticketVendor: ticket.vendorEmail,
        currentVendor: vendorEmail
      })
      throw new Error("No puedes modificar tickets de otros vendedores")
    }
    
    console.log(`🔄 Actualizando ticket ${ticket.id} con decrementos automáticos...`)

    // Usar la función RPC transaccional para actualizar con decrementos
    const { data, error } = await supabaseAdmin.rpc('update_ticket_with_decrements', {
      p_ticket_id: ticket.id,
      p_event_id: eventId,
      p_vendor_email: vendorEmail,
      p_new_ticket_data: mapTicketToSupabase(ticket, eventId)
    })

    if (error) {
      console.error("Error en RPC update_ticket_with_decrements:", error)
      return { success: false, status: "error", message: "Error al actualizar ticket" }
    }

    if (!data || !data.success) {
      console.error("Error actualizando ticket:", data?.error || "Error desconocido")
      return { success: false, status: "error", message: data?.error || "Error al actualizar ticket" }
    }

    console.log(`✅ Ticket actualizado exitosamente:`, {
      ticketId: ticket.id,
      decrementedCount: data.decremented_count
    })

    // Obtener el ticket actualizado
    const { data: updatedTicket, error: fetchError } = await supabaseAdmin
      .from("tickets")
      .select("*")
      .eq("id", ticket.id)
      .single()
      
    if (fetchError || !updatedTicket) {
      console.error("Error obteniendo ticket actualizado:", fetchError)
      return { success: false, status: "error", message: "Error al obtener ticket actualizado" }
    }

    const result = mapTicketFromSupabase(updatedTicket)
    
    // Actualizar localStorage después de la actualización exitosa (solo en cliente)
    if (typeof window !== "undefined") {
      try {
        const localStorageKey = `tickets_${eventId}_${vendorEmail}`
        const existingTickets = JSON.parse(localStorage.getItem(localStorageKey) || "[]")
        const updatedTickets = existingTickets.map(t => t.id === ticket.id ? result : t)
        localStorage.setItem(localStorageKey, JSON.stringify(updatedTickets))
      } catch (error) {
        console.warn("Error actualizando localStorage:", error)
      }
    }

    // Invalidar cache específico del vendedor
    ticketCache.clear()
    
    return result
  } catch (error) {
    console.error("Error en updateTicket:", error)
    return { success: false, status: "error", message: "Error inesperado al actualizar el ticket" }
  }
}

// === FUNCIÓN DELETE TRANSACCIONAL ===
export async function deleteTicket(ticketId: string, eventId: string, vendorEmail: string): Promise<boolean> {
  try {
    if (!vendorEmail) {
      throw new Error("No se proporcionó email de vendedor")
    }

    console.log(`🗑️ Eliminando ticket ${ticketId} de forma transaccional...`)

    // Usar la función RPC transaccional
    const { data, error } = await supabaseAdmin.rpc('delete_ticket_with_decrements', {
      p_ticket_id: ticketId,
      p_event_id: eventId,
      p_vendor_email: vendorEmail
    })

    if (error) {
      console.error("Error en RPC delete_ticket_with_decrements:", error)
      return false
    }

    if (!data || !data.success) {
      console.error("Error eliminando ticket:", data?.error || "Error desconocido")
      return false
    }

    console.log(`✅ Ticket eliminado exitosamente:`, {
      ticketId,
      decrementedCount: data.decremented_count
    })

    // Actualizar localStorage después de eliminar (solo en cliente)
    if (typeof window !== "undefined") {
      try {
        const localStorageKey = `tickets-${eventId}-${vendorEmail}`
        const existingTickets = JSON.parse(localStorage.getItem(localStorageKey) || "[]")
        const filteredTickets = existingTickets.filter(t => t.id !== ticketId)
        localStorage.setItem(localStorageKey, JSON.stringify(filteredTickets))
      } catch (error) {
        console.warn("Error actualizando localStorage:", error)
      }
    }

    // Invalidar cache específico del vendedor
    const cacheKey = `tickets-${eventId}-${vendorEmail}`
    ticketCache.delete(cacheKey)
    
    return true
  } catch (error) {
    console.error("Error in deleteTicket:", error)
    return false
  }
}

// === FUNCIÓN DE SUSCRIPCIÓN OPTIMIZADA ===
export async function subscribeToTickets(
  eventId: string,
  onTicketsChange: (tickets: Ticket[]) => void
) {
  try {
    const currentVendorEmail = safeGetItem("currentVendorEmail")
    if (!currentVendorEmail) {
      console.error("No se encontró email de vendedor para suscripción")
      return () => {}
    }

    // Crear canal único optimizado
    const channelName = `tickets-${eventId}-${currentVendorEmail}-${Date.now()}`
    
    // Limpiar canales existentes
    supabase.removeAllChannels()
    
    // Debounce para evitar actualizaciones excesivas
    let debounceTimer: NodeJS.Timeout | null = null
    
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      
      debounceTimer = setTimeout(async () => {
        console.log('🔄 Actualizando tickets por cambio en tiempo real para vendedor:', currentVendorEmail)
        const updatedTickets = await getTickets(eventId)
        onTicketsChange(updatedTickets)
      }, 500) // 500ms de debounce
    }
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `event_id=eq.${eventId}.and.vendor_email=eq.${currentVendorEmail}` // Filtrar por vendedor
        },
        (payload) => {
          console.log('📡 Cambio en tickets detectado para vendedor:', currentVendorEmail, payload.eventType)
          
          // Invalidar cache específico del vendedor
          const cacheKey = `tickets-${eventId}-${currentVendorEmail}`
          ticketCache.clear()
          
          // Actualizar con debounce
          debouncedUpdate()
        }
      )
      .subscribe((status) => {
        console.log('📡 Estado de suscripción a tickets:', status, 'para vendedor:', currentVendorEmail)
      })
    
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
  } catch (error) {
    console.error("Error en subscribeToTickets:", error)
    return () => {}
  }
}

// === FUNCIÓN DE MIGRACIÓN OPTIMIZADA ===
export async function migrateTicketsWithoutVendor(): Promise<boolean> {
  try {
    const currentVendorEmail = safeGetItem("currentVendorEmail")
    if (!currentVendorEmail) {
      console.warn("No se encontró email de vendedor actual para la migración")
      return false
    }

    const { data: ticketsWithoutVendor, error: fetchError } = await supabase
      .from("tickets")
      .select("id, vendor_email")
      .or("vendor_email.is.null,vendor_email.eq.unknown")
      .limit(100) // Procesar en lotes

    if (fetchError) {
      console.error("Error obteniendo tickets sin vendedor:", fetchError)
      return false
    }

    if (!ticketsWithoutVendor || ticketsWithoutVendor.length === 0) {
      console.log("✅ No hay tickets sin vendedor para migrar")
      return true
    }

    // Actualizar en lotes para mejor rendimiento
    const batchSize = 10
    const batches = []
    
    for (let i = 0; i < ticketsWithoutVendor.length; i += batchSize) {
      batches.push(ticketsWithoutVendor.slice(i, i + batchSize))
    }

    let successCount = 0
    
    for (const batch of batches) {
      const updatePromises = batch.map(async (ticket) => {
        try {
          const { error: updateError } = await supabaseAdmin
            .from("tickets")
            .update({ vendor_email: currentVendorEmail })
            .eq("id", ticket.id)

          if (updateError) {
            console.error(`Error actualizando ticket ${ticket.id}:`, updateError)
            return false
          }
          return true
        } catch (error) {
          console.error(`Error al procesar ticket ${ticket.id}:`, error)
          return false
        }
      })

      const results = await Promise.all(updatePromises)
      successCount += results.filter(Boolean).length
    }

    console.log(`✅ Migración completada: ${successCount}/${ticketsWithoutVendor.length} tickets actualizados para vendedor: ${currentVendorEmail}`)
    
    // Invalidar cache
    ticketCache.clear()
    
    return successCount === ticketsWithoutVendor.length
  } catch (error) {
    console.error("Error en migrateTicketsWithoutVendor:", error)
    return false
  }
}