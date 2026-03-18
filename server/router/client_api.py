"""
Router for client-to-server API calls.

These endpoints are NOT protected by JWT authentication.
Instead, they use a pre-shared CLIENT_SECRET to verify that the request
is coming from an authorized client machine (e.g., via PAM scripts).
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from ..CRUD.users import _trigger_user_sync, get_user_by_username
from ..models.password_models import PasswordChangeFromClient
from ..utils.db import get_db

CLIENT_SECRET = os.getenv("CLIENT_SECRET", "")
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/client-api", tags=["Client API"])


def verify_client_secret(x_client_secret: Optional[str] = Header(default=None)):
    """
    Dependency that verifies the X-Client-Secret header against the
    configured CLIENT_SECRET environment variable.

    This ensures only authorized client machines (that know the secret)
    can call these endpoints.
    """
    if not CLIENT_SECRET:
        logger.error("CLIENT_SECRET is not configured on the server")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CLIENT_SECRET is not configured on the server. "
            "Set the CLIENT_SECRET environment variable to enable client API access.",
        )

    if not x_client_secret:
        logger.warning("Missing X-Client-Secret header in client API request")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Client-Secret header",
        )

    if x_client_secret != CLIENT_SECRET:
        logger.warning("Invalid X-Client-Secret header in client API request")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid client secret",
        )


@router.post("/users/{username}/change-password")
def change_password_from_client(
    username: str,
    password_data: PasswordChangeFromClient,
    x_client_host: Optional[str] = Header(None),
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_client_secret),
):
    """
    Endpoint to receive password changes from client machines.

    Called when a user changes their password via SSH/passwd on a client.
    The PAM module on the client triggers sync_password_change.sh, which
    calls this endpoint with the X-Client-Secret header for authentication.
    """
    logger.info(
        "Received client password sync request username=%s source_client=%s",
        username,
        x_client_host,
    )

    # Look up the user
    user = get_user_by_username(db, username)
    if not user:
        logger.warning("User not found for client password sync username=%s", username)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{username}' not found",
        )

    # Hash the new password
    hashed_password = bcrypt.hashpw(
        password_data.new_password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")

    # Update the password in the central database
    user.password_hash = hashed_password
    user.must_change_password = False  # User already changed their password
    user.password_changed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    # Sync the updated user to all clients
    _trigger_user_sync(db)

    logger.info(
        "Client password sync completed username=%s source_client=%s",
        username,
        x_client_host,
    )

    return {
        "success": True,
        "message": f"Password updated for user '{username}' and synced to all clients",
        "username": username,
        "source_client": x_client_host,
        "must_change_password": False,
    }
