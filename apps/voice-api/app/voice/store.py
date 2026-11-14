"""Call sessions and transcripts in the shared database.

voice-api connects as its own role, voice_service, which may only touch voice_sessions and
voice_turns. Row Level Security lets it see and write only the rows of the institution it names
with app.institution_id, set inside each transaction; a query for any other institution sees
nothing and an insert for one is refused.
"""

import os
import uuid
from contextlib import contextmanager
from typing import Optional

import app.config  # noqa: F401  (loads apps/voice-api/.env)


class StoreUnavailable(Exception):
    pass


def database_url() -> str:
    return os.getenv("VOICE_DATABASE_URL", "")


def is_configured() -> bool:
    return bool(database_url())


@contextmanager
def tenant(institution_id: str):
    """A transaction limited to one institution by Row Level Security."""
    if not is_configured():
        raise StoreUnavailable("VOICE_DATABASE_URL is not set, so call transcripts cannot be saved.")
    import psycopg

    try:
        connection = psycopg.connect(database_url(), connect_timeout=5)
    except psycopg.OperationalError as err:
        raise StoreUnavailable(f"The database could not be reached: {err.__class__.__name__}") from err
    try:
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute("SELECT set_config('app.institution_id', %s, true)", (institution_id,))
                yield cursor
    finally:
        connection.close()


def create_session(institution_id: str, user_id: str, user_name: str, channel: str) -> str:
    session_id = str(uuid.uuid4())
    with tenant(institution_id) as cursor:
        cursor.execute(
            "INSERT INTO voice_sessions (id, institution_id, user_id, user_name, channel) VALUES (%s, %s, %s, %s, %s)",
            (session_id, institution_id, user_id, user_name[:150], channel),
        )
    return session_id


def session_status(institution_id: str, session_id: str) -> Optional[str]:
    with tenant(institution_id) as cursor:
        cursor.execute("SELECT status FROM voice_sessions WHERE id = %s", (session_id,))
        row = cursor.fetchone()
    return row[0] if row else None


def add_turn(institution_id: str, session_id: str, speaker: str, text: str, language: str,
             question_id: Optional[str] = None, audio_ms: int = 0, processing_ms: int = 0) -> str:
    turn_id = str(uuid.uuid4())
    with tenant(institution_id) as cursor:
        cursor.execute(
            """INSERT INTO voice_turns (id, institution_id, session_id, speaker, text, language, question_id, audio_ms, processing_ms)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (turn_id, institution_id, session_id, speaker, text, language, question_id, audio_ms, processing_ms),
        )
        cursor.execute(
            "UPDATE voice_sessions SET turns = turns + 1, language = CASE WHEN language = '' THEN %s ELSE language END WHERE id = %s",
            (language, session_id),
        )
    return turn_id


def end_session(institution_id: str, session_id: str) -> bool:
    with tenant(institution_id) as cursor:
        cursor.execute("UPDATE voice_sessions SET status = 'ENDED', ended_at = NOW() WHERE id = %s AND status = 'ACTIVE'", (session_id,))
        return cursor.rowcount > 0
