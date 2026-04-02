#!/usr/bin/env python3
"""
Script de migración para cambiar el rango de UIDs de 2000 a 4000.

Uso:
    python migrate_uid_range_4000.py
    
Este script:
1. Renumera todos los UIDs comenzando desde 4000
2. Dispara la sincronización automáticamente en todos los clientes
"""

import sys
import os
from pathlib import Path
from datetime import datetime

# Agregar la raíz del proyecto al path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import text, func
from server.utils.db import SessionLocal
from server.models.models import User
from server.CRUD.users import _trigger_user_sync


def print_header(message: str):
    """Imprime un encabezado formateado"""
    print("━" * 60)
    print(f"🔄 {message}")
    print("━" * 60)
    print()


def print_section(message: str):
    """Imprime una sección"""
    print(f"\n📌 {message}\n")


def show_current_state(db):
    """Muestra el estado actual de los UIDs"""
    result = db.query(
        func.count(User.id).label("total"),
        func.min(User.system_uid).label("min_uid"),
        func.max(User.system_uid).label("max_uid"),
    ).first()
    
    print(f"  Total de usuarios: {result.total}")
    if result.total > 0:
        print(f"  UID mínimo: {result.min_uid}")
        print(f"  UID máximo: {result.max_uid}")
    print()


def get_confirmation(message: str = "¿Continuar?") -> bool:
    """Pide confirmación al usuario"""
    response = input(f"\n⚠️  {message} (s/n): ").strip().lower()
    return response in ['s', 'si', 'yes', 'y']


def main():
    """Función principal"""
    print_header("Migración: Cambiar Rango de UIDs a partir de 4000")
    
    # Conectar a la BD
    print_section("Estado actual")
    db = SessionLocal()
    
    try:
        show_current_state(db)
        
        # Mostrar usuarios actuales
        print("📋 Usuarios actuales:")
        users = db.query(User).order_by(User.id).all()
        for user in users:
            print(f"  - {user.username:<20} UID: {user.system_uid} (activo: {user.is_active})")
        print()
        
        # Pedir confirmación
        if not get_confirmation("¿Renumerar UIDs comenzando desde 4000?"):
            print("❌ Migración cancelada\n")
            return
        
        # Ejecutar migración
        print_section("Ejecutando migración")
        
        # Obtener usuarios ordenados por ID
        users_to_update = db.query(User).order_by(User.id).all()
        
        print("🔄 Renumerando UIDs:")
        new_uid = 4000
        for user in users_to_update:
            old_uid = user.system_uid
            user.system_uid = new_uid
            print(f"  - {user.username:<20} {old_uid:>5} → {new_uid:>5}")
            new_uid += 1
        
        # Guardar cambios en la BD
        db.commit()
        print()
        print("✅ UIDs actualizados en la base de datos")
        print()
        
        # Mostrar nuevo estado
        print_section("Nuevo estado")
        show_current_state(db)
        
        # Disparar sincronización
        print_section("Sincronizando con clientes")
        print("🌍 Enviando actualización a todos los clientes...")
        print("   Esto puede tomar unos minutos...")
        print()
        
        try:
            _trigger_user_sync(db)
            print("✅ Sincronización disparada exitosamente")
        except Exception as e:
            print(f"⚠️  Sincronización completada con advertencias: {str(e)}")
        
        print()
        print("━" * 60)
        print("✅ Migración completada exitosamente")
        print("━" * 60)
        print()
        print("📌 Próximos pasos:")
        print()
        print("  1. Espera a que se sincronicen los clientes (5-10 minutos)")
        print()
        print("  2. Verifica en los clientes:")
        print("     cat /etc/passwd-pgsql | grep -E '^[a-z]' | awk -F: '{print $1, $3}'")
        print()
        print("  3. Opcional - Sincronizar permisos Docker en cada cliente:")
        print("     sudo bash client/utils/sync_docker_group.sh")
        print()
        
    except Exception as e:
        print(f"❌ Error durante la migración: {str(e)}")
        print()
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n❌ Migración cancelada por el usuario\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Error fatal: {str(e)}\n")
        sys.exit(1)
