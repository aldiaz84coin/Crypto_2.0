// algorithm-config.js - Sistema de Configuración Básico (Iteración 1)

/**
 * CONFIGURACIÓN POR DEFECTO
 * En Iteración 1 manejamos solo 3 parámetros básicos:
 * - quantitativeWeight: Peso de factores cuantitativos (0-1)
 * - qualitativeWeight: Peso de factores cualitativos (0-1)
 * - boostPowerThreshold: Umbral para clasificar como INVERTIBLE (0.30-0.50)
 */

const DEFAULT_CONFIG = {
  version: '3.1-iter1',
  
  // Pesos principales (deben sumar 1.0)
  quantitativeWeight: 0.60,  // 60% peso a factores cuantitativos
  qualitativeWeight: 0.40,   // 40% peso a factores cualitativos
  
  // Umbral de clasificación
  boostPowerThreshold: 0.40,  // >=0.40 = INVERTIBLE
  
  // Metadata
  lastModified: null,
  modifiedBy: 'default'
};

/**
 * Validar configuración
 */
function validateConfig(config) {
  const errors = [];
  
  // Validar que existan los campos requeridos
  if (typeof config.quantitativeWeight !== 'number') {
    errors.push('quantitativeWeight debe ser un número');
  }
  
  if (typeof config.qualitativeWeight !== 'number') {
    errors.push('qualitativeWeight debe ser un número');
  }
  
  if (typeof config.boostPowerThreshold !== 'number') {
    errors.push('boostPowerThreshold debe ser un número');
  }
  
  // Validar rangos
  if (config.quantitativeWeight < 0 || config.quantitativeWeight > 1) {
    errors.push('quantitativeWeight debe estar entre 0 y 1');
  }
  
  if (config.qualitativeWeight < 0 || config.qualitativeWeight > 1) {
    errors.push('qualitativeWeight debe estar entre 0 y 1');
  }
  
  // Validar que sumen aproximadamente 1.0
  const sum = config.quantitativeWeight + config.qualitativeWeight;
  if (Math.abs(sum - 1.0) > 0.01) {
    errors.push(`Los pesos deben sumar 1.0 (actual: ${sum.toFixed(2)})`);
  }
  
  // Validar threshold
  if (config.boostPowerThreshold < 0.30 || config.boostPowerThreshold > 0.50) {
    errors.push('boostPowerThreshold debe estar entre 0.30 y 0.50');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Obtener configuración (desde KV o default)
 */
async function getConfig(kvHelpers) {
  if (!kvHelpers) {
    return DEFAULT_CONFIG;
  }
  
  try {
    const stored = await kvHelpers.get('algorithm-config:v1');
    if (stored && stored.value) {
      const config = JSON.parse(stored.value);
      return config;
    }
  } catch (error) {
    console.error('Error loading config from KV:', error);
  }
  
  return DEFAULT_CONFIG;
}

/**
 * Guardar configuración
 */
async function saveConfig(kvHelpers, config) {
  if (!kvHelpers) {
    return { success: false, error: 'KV no disponible' };
  }
  
  // Validar primero
  const validation = validateConfig(config);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }
  
  // Añadir metadata
  config.lastModified = new Date().toISOString();
  config.version = '3.1-iter1';
  
  try {
    await kvHelpers.set('algorithm-config:v1', JSON.stringify(config));
    return { success: true, config: config };
  } catch (error) {
    console.error('Error saving config to KV:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Resetear a configuración por defecto
 */
async function resetConfig(kvHelpers) {
  const defaultConfig = { ...DEFAULT_CONFIG };
  defaultConfig.lastModified = new Date().toISOString();
  
  if (kvHelpers) {
    try {
      await kvHelpers.set('algorithm-config:v1', JSON.stringify(defaultConfig));
    } catch (error) {
      console.error('Error resetting config:', error);
    }
  }
  
  return defaultConfig;
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  saveConfig,
  validateConfig,
  resetConfig
};
