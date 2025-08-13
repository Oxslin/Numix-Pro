"use client"

import React from "react"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Clock, Ticket, ChevronRight, Search } from "lucide-react"
import { Card } from "@/components/ui/card"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { debounce } from "@/lib/performance-utils"

// Importar los componentes y utilidades refactorizados
import { PageHeader } from "@/components/ui/page-header"
import { StatsCard } from "@/components/ui/stats-card"
import { getNumberStyle } from "@/lib/prize-utils"
import { PRICE_PER_TIME } from "@/lib/constants"
// Eliminar esta línea:
// import { supabase } from "@/lib/supabase"

// No necesitas importar nada más, usaremos importación dinámica

interface Draw {
  id: string
  name: string
  date: string
  endTime: string
  totalTickets: number
  status: string
  awardedNumbers?: {
    firstPrize: string
    secondPrize: string
    thirdPrize: string
    awardedAt?: string
  }
}

interface TicketData {
  number: string
  timesSold: number
}

// Componente memoizado para mostrar un número
const NumberCell = React.memo(
  ({
    number,
    timesSold,
    style,
  }: {
    number: string
    timesSold: number
    style: React.CSSProperties
  }) => {
    return (
      <div
        className={`flex justify-between items-center p-3 rounded-lg ${
          timesSold > 0 ? "bg-muted" : "bg-card border border-border"
        }`}
      >
        <span className="text-lg font-medium" style={style}>
          {number}
        </span>
        <span className={`${timesSold > 0 ? "text-primary" : "text-muted-foreground"}`}>{timesSold}</span>
      </div>
    )
  },
)

export default function ReportesPage() {
  const router = useRouter()
  const [selectedDate, setSelectedDate] = useState("")
  const [closedDraws, setClosedDraws] = useState<Draw[]>([])
  const [activeDraws, setActiveDraws] = useState<Draw[]>([])
  const [selectedDraw, setSelectedDraw] = useState<Draw | null>(null)
  const [ticketData, setTicketData] = useState<TicketData[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isResetting, setIsResetting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showLiveReports, setShowLiveReports] = useState(false)

  // Debounce search query to avoid excessive filtering
  const debouncedSetSearchQuery = useCallback(
    debounce((value: string) => {
      setSearchQuery(value)
    }, 300),
    [],
  )

  // Función para refrescar la página y recargar los datos
  const handleRefresh = useCallback(() => {
    setIsResetting(true)
    // Limpiar todos los filtros
    setSelectedDate("")
    setSearchQuery("")
    setSelectedDraw(null)
    setTicketData([])
    setClosedDraws([])
    setActiveDraws([])
    setShowLiveReports(false)

    // Efecto visual de reset
    setTimeout(() => {
      setIsResetting(false)
    }, 500)
  }, [])

  // Función para limpiar la pantalla (ahora handleRefresh y handleReset hacen lo mismo)
  const handleReset = handleRefresh

  // Función para cargar sorteos cerrados
  const loadClosedDraws = useCallback(
    async (date: string) => {
      setIsLoading(true)
      try {
        const currentVendorEmail = localStorage.getItem("currentVendorEmail")
        if (!currentVendorEmail) {
          console.error("No se encontró email de vendedor actual")
          setIsLoading(false)
          router.push("/")
          return
        }

        // Importación dinámica para supabaseAdmin
        const { getSupabaseClient } = await import("@/lib/fetch-utils")
        const supabaseAdmin = getSupabaseClient(true)
        
        // Importar y ejecutar función de cierre automático
        const { autoCloseExpiredEvents } = await import("@/lib/events")
        await autoCloseExpiredEvents()

        // Obtener fecha y hora actual para comparación
        const now = new Date()
        const currentDate = now.toISOString().split('T')[0]
        const currentTime = now.toTimeString().split(' ')[0].substring(0, 5)

        // Consultar eventos cerrados: por estado O por fecha/hora expirada
        const { data: events, error: eventsError } = await supabaseAdmin
          .from("events")
          .select("*")
          .eq("end_date", date)
          .or(`status.in.(closed_awarded,closed_not_awarded),and(status.eq.active,end_date.lt.${currentDate}),and(status.eq.active,end_date.eq.${currentDate},end_time.lte.${currentTime})`)

        if (eventsError) {
          console.error("Error fetching closed events:", eventsError)
          setClosedDraws([])
          return
        }

        if (!events || events.length === 0) {
          setClosedDraws([])
          return
        }

        // Procesar todos los eventos cerrados
        const formattedDraws: Draw[] = []
        
        for (const event of events) {
          try {
            const { data: vendorTickets, error } = await supabaseAdmin
              .from("tickets")
              .select("*")
              .eq("event_id", event.id)
              .eq("vendor_email", currentVendorEmail)

            if (error) {
              console.error("Error fetching tickets for event:", error)
              continue
            }

            formattedDraws.push({
              id: event.id,
              name: event.name,
              date: event.end_date,
              endTime: event.end_time,
              totalTickets: vendorTickets?.length || 0,
              status: "closed",
              awardedNumbers: event.first_prize
                ? {
                    firstPrize: event.first_prize,
                    secondPrize: event.second_prize,
                    thirdPrize: event.third_prize,
                    awardedAt: event.awarded_at,
                  }
                : undefined,
            })
          } catch (error) {
            console.error("Error processing event:", event.id, error)
          }
        }

        setClosedDraws(formattedDraws)
      } catch (error) {
        console.error("Error loading closed draws:", error)
        setClosedDraws([])
      } finally {
        setIsLoading(false)
      }
    },
    [router],
  )

  // Nueva función para cargar sorteos activos
  const loadActiveDraws = useCallback(
    async (date: string) => {
      setIsLoading(true)
      try {
        const currentVendorEmail = localStorage.getItem("currentVendorEmail")
        if (!currentVendorEmail) {
          console.error("No se encontró email de vendedor actual")
          setIsLoading(false)
          router.push("/")
          return
        }

        // Obtener el cliente admin
        const { getSupabaseClient } = await import("@/lib/fetch-utils")
        const supabaseAdmin = getSupabaseClient(true)

        // Consultar eventos activos con consulta más flexible
        const { data: events, error: eventsError } = await supabaseAdmin
          .from("events")
          .select("*")
          .eq("active", true)
          .or(`end_date.eq.${date},start_date.eq.${date}`)

        if (eventsError) {
          console.error("Error fetching active events:", eventsError)
          setActiveDraws([])
          return
        }

        if (!events || events.length === 0) {
          setActiveDraws([])
          return
        }

        // Filtrar eventos que aún no han terminado
        const currentDateTime = new Date()
        const activeEvents = events.filter((event) => {
          const endDateTime = new Date(`${event.end_date} ${event.end_time}`)
          return endDateTime > currentDateTime
        })

        // Procesar todos los eventos activos
        const formattedDraws: Draw[] = []
        
        for (const event of activeEvents) {
          try {
            const { data: vendorTickets, error } = await supabaseAdmin
              .from("tickets")
              .select("*")
              .eq("event_id", event.id)
              .eq("vendor_email", currentVendorEmail)

            if (error) {
              console.error("Error fetching tickets for event:", error)
              continue
            }

            formattedDraws.push({
              id: event.id,
              name: event.name,
              date: event.end_date,
              endTime: event.end_time,
              totalTickets: vendorTickets?.length || 0,
              status: "active",
              awardedNumbers: undefined,
            })
          } catch (error) {
            console.error("Error processing event:", event.id, error)
          }
        }

        setActiveDraws(formattedDraws)
      } catch (error) {
        console.error("Error loading active draws:", error)
        setActiveDraws([])
      } finally {
        setIsLoading(false)
      }
    },
    [router],
  )

  // Efecto para cargar los sorteos cuando se selecciona una fecha
  useEffect(() => {
    if (selectedDate) {
      if (showLiveReports) {
        loadActiveDraws(selectedDate)
      } else {
        loadClosedDraws(selectedDate)
      }
    } else {
      setClosedDraws([])
      setActiveDraws([])
    }
  }, [selectedDate, showLiveReports, loadClosedDraws, loadActiveDraws])

  // Modificar el useEffect para cargar datos de tickets (línea 291):
  useEffect(() => {
    const loadTicketData = async () => {
      if (selectedDraw) {
        setIsLoading(true)
        try {
          const currentVendorEmail = localStorage.getItem("currentVendorEmail")
          if (!currentVendorEmail) {
            console.error("No se encontró email de vendedor actual")
            setIsLoading(false)
            router.push("/")
            return
          }

          // Obtener el cliente admin
          const { getSupabaseClient } = await import("@/lib/fetch-utils")
          const supabaseAdmin = getSupabaseClient(true)
      
          // Obtener tickets directamente de Supabase
          const { data: tickets, error } = await supabaseAdmin
            .from("tickets")
            .select("*")
            .eq("event_id", selectedDraw.id)
            .eq("vendor_email", currentVendorEmail)
      
          if (error) {
            console.error("Error fetching tickets:", error)
            setTicketData([])
            setIsLoading(false)
            return
          }
      
          // Crear un array de 100 números (00-99) con tiempos inicializados en 0
          const numberCounts: { [key: string]: number } = {}
          for (let i = 0; i < 100; i++) {
            const number = i.toString().padStart(2, "0")
            numberCounts[number] = 0
          }
      
          // Procesar tickets
          tickets?.forEach((ticket) => {
            const ticketRows = Array.isArray(ticket.rows) ? ticket.rows : JSON.parse(String(ticket.rows || "[]"))
            ticketRows.forEach((row: any) => {
              if (row.actions) {
                const number = row.actions.toString().padStart(2, "0")
                const times = Number.parseInt(row.times) || 0
                numberCounts[number] = (numberCounts[number] || 0) + times
              }
            })
          })
      
          // Convertir a array y ordenar
          const sortedData = Object.entries(numberCounts)
            .map(([number, times]) => ({
              number,
              timesSold: times,
            }))
            .sort((a, b) => Number.parseInt(a.number) - Number.parseInt(b.number))
      
          setTicketData(sortedData)
          setIsLoading(false)
        } catch (error) {
          console.error("Error loading ticket data:", error)
          setTicketData([])
          setIsLoading(false)
        }
      }
    }
  
    loadTicketData()
  }, [selectedDraw, router])

  // Efecto para actualización automática en reportes en vivo
  useEffect(() => {
    let interval: NodeJS.Timeout
    
    if (showLiveReports && selectedDraw) {
      // Actualizar cada 30 segundos para reportes en vivo
      interval = setInterval(() => {
        if (selectedDate) {
          loadActiveDraws(selectedDate)
        }
      }, 30000)
    }

    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [showLiveReports, selectedDraw, selectedDate, loadActiveDraws])

  // Memoizar los números filtrados
  const filteredTicketData = useMemo(() => {
    return ticketData.filter((data) => data.number.includes(searchQuery))
  }, [ticketData, searchQuery])

  // Calcular totales
  const totalTimesSold = useMemo(() => {
    return filteredTicketData.reduce((sum, data) => sum + data.timesSold, 0)
  }, [filteredTicketData])

  const totalAmount = useMemo(() => {
    return totalTimesSold * PRICE_PER_TIME
  }, [totalTimesSold])

  // Organizar números en columnas (00-24, 25-49, 50-74, 75-99)
  const numberColumns = useMemo(
    () => [
      filteredTicketData.slice(0, 25), // 00-24
      filteredTicketData.slice(25, 50), // 25-49
      filteredTicketData.slice(50, 75), // 50-74
      filteredTicketData.slice(75, 100), // 75-99
    ],
    [filteredTicketData],
  )

  // Calcular totales por columna
  const columnTotals = useMemo(() => {
    return numberColumns.map((column) => column.reduce((sum, data) => sum + data.timesSold, 0))
  }, [numberColumns])

  // Memoizar la función getReportNumberStyle
  const getReportNumberStyle = useCallback(
    (number: string): React.CSSProperties => {
      return getNumberStyle(number, selectedDraw?.awardedNumbers)
    },
    [selectedDraw?.awardedNumbers],
  )

  // Mostrar un indicador de carga durante la carga
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PageHeader
          title="Reporte General"
          backUrl="/vendedor/dashboard"
          onRefresh={handleRefresh}
          isRefreshing={isResetting}
        />
        <div className="flex items-center justify-center h-[80vh]">
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin mb-4"></div>
            <p>Cargando datos...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <PageHeader
        title="Reporte General"
        backUrl="/vendedor/dashboard"
        onRefresh={handleRefresh}
        isRefreshing={isResetting}
      />

      <div className="p-4 space-y-6">
        <ErrorBoundary>
          {/* Date Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Fecha del sorteo</label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full bg-input border border-border text-foreground placeholder-muted-foreground"
            />
          </div>

          {/* Toggle para reportes en vivo */}
          {selectedDate && (
            <div className="flex items-center space-x-4 p-4 bg-card border border-border rounded-xl">
              <span className="text-sm font-medium text-muted-foreground">
                Tipo de reporte:
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setShowLiveReports(false)
                    setSelectedDraw(null)
                    setTicketData([])
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    !showLiveReports
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  Sorteos Cerrados
                </button>
                <button
                  onClick={() => {
                    setShowLiveReports(true)
                    setSelectedDraw(null)
                    setTicketData([])
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    showLiveReports
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  🔴 Reportes en Vivo
                </button>
              </div>
            </div>
          )}

          {/* Lista de sorteos (activos o cerrados según el toggle) */}
          {selectedDate && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                {showLiveReports ? "Sorteos activos (en vivo)" : "Sorteos cerrados"}
              </label>
              <div className="space-y-2">
                {(showLiveReports ? activeDraws : closedDraws).map((draw) => (
                  <Card
                    key={draw.id}
                    className={`bg-card border-border p-4 rounded-xl cursor-pointer transition-colors ${
                      selectedDraw?.id === draw.id
                        ? "bg-gradient-to-r from-primary/20 to-secondary/20"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => setSelectedDraw(draw)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-medium text-primary">{draw.name}</h3>
                          {showLiveReports && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              🔴 EN VIVO
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                          <span className="flex items-center">
                            <Clock className="h-4 w-4 mr-1" />
                            {draw.endTime}
                          </span>
                          <span className="flex items-center">
                            <Ticket className="h-4 w-4 mr-1" />
                            {draw.totalTickets} tickets
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                ))}
                {(showLiveReports ? activeDraws : closedDraws).length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    {showLiveReports 
                      ? "No hay sorteos activos para esta fecha" 
                      : "No hay sorteos cerrados para esta fecha"}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selected Draw Details */}
          {selectedDraw && (
            <div className="space-y-6">
              {/* Indicador de estado en vivo */}
              {showLiveReports && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <h3 className="text-sm font-medium text-green-800">Reporte en Vivo</h3>
                  </div>
                  <p className="text-sm text-green-600 mt-1">
                    Los datos se actualizan automáticamente cada 30 segundos
                  </p>
                </div>
              )}

              {/* Números premiados - solo para sorteos cerrados */}
              {!showLiveReports && selectedDraw.awardedNumbers && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Números Premiados</h3>
                  <div className="flex items-center space-x-4 justify-center">
                    <div className="flex items-center space-x-2">
                      <span className="text-[#FFD700] font-bold text-lg">{selectedDraw.awardedNumbers.firstPrize}</span>
                      <span className="text-xs text-muted-foreground">(×11)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[#9333EA] font-bold text-lg">
                        {selectedDraw.awardedNumbers.secondPrize}
                      </span>
                      <span className="text-xs text-muted-foreground">(×3)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[#FF6B6B] font-bold text-lg">{selectedDraw.awardedNumbers.thirdPrize}</span>
                      <span className="text-xs text-muted-foreground">(×2)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Search Numbers */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
                <Input
                  type="text"
                  placeholder="Buscar número..."
                  value={searchQuery}
                  onChange={(e) => debouncedSetSearchQuery(e.target.value)}
                  className="pl-10 bg-input border border-border text-foreground"
                />
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-4">
                <StatsCard value={totalTimesSold} label="Total tiempos vendidos" />
                <StatsCard value={`$${totalAmount.toFixed(2)}`} label="Total vendido" />
              </div>

              {/* Numbers Table */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-lg font-medium mb-4">Detalle de números</h3>
                <div className="grid grid-cols-4 gap-4">
                  {numberColumns.map((column, columnIndex) => (
                    <div key={columnIndex} className="space-y-2">
                      {column.map((data) => (
                        <NumberCell
                          key={data.number}
                          number={data.number}
                          timesSold={data.timesSold}
                          style={getReportNumberStyle(data.number)}
                        />
                      ))}
                      <div className="mt-4 p-3 bg-gradient-to-r from-primary to-secondary rounded-lg">
                        <span className="text-lg font-bold text-white">{columnTotals[columnIndex]}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}