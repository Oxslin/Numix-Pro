import { supabase, supabaseAdmin } from "./supabase"
import type { Vendor } from "@/types"
import { hashPassword, verifyPassword } from "./auth"

// Convertir de formato Supabase a formato de la aplicación
const mapVendorFromSupabase = (vendor: any): Vendor => ({
  id: vendor.id,
  name: vendor.name,
  email: vendor.email,
  password: vendor.password,
  active: vendor.active,
})

// Obtener todos los vendedores
export async function getVendors(): Promise<Vendor[]> {
  try {
    console.log("Iniciando carga de vendedores desde Supabase...") // Debug
    
    // Usar supabaseAdmin en lugar de supabase para evitar RLS
    const { data, error } = await supabaseAdmin
      .from("vendors")
      .select("*")
      .order("created_at", { ascending: false })
    
    if (error) {
      console.error("Error fetching vendors:", {
        message: error.message,
        details: error.details,
        code: error.code,
        hint: error.hint
      })
      
      // Fallback a localStorage
      if (typeof window !== "undefined") {
        const localVendors = localStorage.getItem("vendors")
        if (localVendors) {
          console.log("Usando vendedores desde localStorage")
          return JSON.parse(localVendors)
        }
      }
      return []
    }

    console.log("Vendedores cargados desde Supabase:", data?.length || 0) // Debug
    
    if (!data) {
      console.log("No se encontraron vendedores en Supabase")
      return []
    }

    const vendors = data.map(mapVendorFromSupabase)
    
    // Actualizar localStorage con los datos de Supabase
    if (typeof window !== "undefined") {
      localStorage.setItem("vendors", JSON.stringify(vendors))
    }
    
    return vendors
  } catch (error) {
    console.error("Error in getVendors:", error)
    
    // Fallback a localStorage en caso de error
    if (typeof window !== "undefined") {
      const localVendors = localStorage.getItem("vendors")
      if (localVendors) {
        console.log("Usando vendedores desde localStorage debido a error")
        return JSON.parse(localVendors)
      }
    }
    return []
  }
}

// Crear un nuevo vendedor
export async function createVendor(vendor: Omit<Vendor, "id">): Promise<Vendor | null> {
  try {
    // Hash de la contraseña antes de almacenarla
    const hashedPassword = await hashPassword(vendor.password)

    // Usar supabaseAdmin en lugar de supabase para evitar RLS
    const { data, error } = await supabaseAdmin
      .from("vendors")
      .insert([
        {
          name: vendor.name,
          email: vendor.email,
          password: hashedPassword, // Almacenar el hash, no la contraseña original
          active: vendor.active,
        },
      ])
      .select()
      .single()

    if (error) {
      console.error("Error creating vendor:", error)
      return null
    }

    const newVendor = mapVendorFromSupabase(data)

    // Actualizar localStorage
    const localVendors = JSON.parse(localStorage.getItem("vendors") || "[]")
    localStorage.setItem("vendors", JSON.stringify([...localVendors, newVendor]))

    return newVendor
  } catch (error) {
    console.error("Error in createVendor:", error)
    return null
  }
}

// Actualizar un vendedor existente
export async function updateVendor(vendor: Vendor): Promise<Vendor | null> {
  try {
    // Obtener el vendedor actual para verificar si la contraseña ha cambiado
    const { data: existingVendor, error: fetchError } = await supabaseAdmin
      .from("vendors")
      .select("password")
      .eq("id", vendor.id)
      .single()

    if (fetchError) {
      console.error("Error fetching existing vendor:", fetchError)
      return null
    }

    // Determinar si necesitamos hacer hash de la contraseña
    let passwordToUpdate = vendor.password

    // Si la contraseña ha cambiado, crear un nuevo hash
    if (existingVendor.password !== vendor.password) {
      passwordToUpdate = await hashPassword(vendor.password)
    }

    const { data, error } = await supabaseAdmin
      .from("vendors")
      .update({
        name: vendor.name,
        email: vendor.email,
        password: passwordToUpdate,
        active: vendor.active,
      })
      .eq("id", vendor.id)
      .select()
      .single()

    if (error) {
      console.error("Error updating vendor:", error)
      return null
    }

    const updatedVendor = mapVendorFromSupabase(data)

    // Actualizar localStorage
    const localVendors = JSON.parse(localStorage.getItem("vendors") || "[]")
    const updatedLocalVendors = localVendors.map((v: Vendor) => (v.id === vendor.id ? updatedVendor : v))
    localStorage.setItem("vendors", JSON.stringify(updatedLocalVendors))

    return updatedVendor
  } catch (error) {
    console.error("Error in updateVendor:", error)
    return null
  }
}

// Eliminar un vendedor
export async function deleteVendor(id: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("vendors").delete().eq("id", id)

    if (error) {
      console.error("Error deleting vendor:", error)
      return false
    }

    // Actualizar localStorage
    const localVendors = JSON.parse(localStorage.getItem("vendors") || "[]")
    const filteredVendors = localVendors.filter((v: Vendor) => v.id !== id)
    localStorage.setItem("vendors", JSON.stringify(filteredVendors))

    return true
  } catch (error) {
    console.error("Error in deleteVendor:", error)
    return false
  }
}

// Verificar credenciales de vendedor (para login)
export async function verifyVendorCredentials(email: string, password: string): Promise<Vendor | null> {
  try {
    // 🔧 CAMBIO: usar supabaseAdmin en lugar de supabase
    const { data, error } = await supabaseAdmin.from("vendors").select("*").eq("email", email).eq("active", true)

    // Si hay un error o no hay datos, retornamos null
    if (error || !data || data.length === 0) {
      console.log("No se encontró vendedor con ese email o está inactivo")
      return null
    }

    // Verificar la contraseña con bcrypt
    const isPasswordValid = await verifyPassword(password, data[0].password)

    if (!isPasswordValid) {
      console.log("Contraseña incorrecta")
      return null
    }

    // Si llegamos aquí, las credenciales son válidas
    return mapVendorFromSupabase(data[0])
  } catch (error) {
    console.error("Error in verifyVendorCredentials:", error)
    return null
  }
}

