"""R07-T10: Recipe MVP — sequential step executor for agentmb sessions.

Provides a lightweight Recipe class that lets you compose browser automation
workflows as named steps with automatic error reporting and optional checkpoint
persistence.

Sync usage (BrowserClient + Session)::

    from agentmb import BrowserClient
    from agentmb.recipe import Recipe

    client = BrowserClient()
    with client.sessions.create(profile="demo") as session:
        recipe = Recipe(session, name="search-workflow")

        @recipe.step("open_search")
        def open_search(s):
            s.navigate("https://example.com")

        @recipe.step("submit_query")
        def submit_query(s):
            s.fill(selector="#q", value="agentmb")
            s.click(selector="button[type=submit]")

        result = recipe.run()
        print(result.summary())

Async usage (AsyncBrowserClient + AsyncSession)::

    from agentmb import AsyncBrowserClient
    from agentmb.recipe import AsyncRecipe
    import asyncio

    async def main():
        async with AsyncBrowserClient() as client:
            async with client.sessions.create(profile="demo") as session:
                recipe = AsyncRecipe(session, name="async-workflow")

                @recipe.step("open_page")
                async def open_page(s):
                    await s.navigate("https://example.com")

                result = await recipe.run()
                print(result.summary())

    asyncio.run(main())
"""

from __future__ import annotations

import inspect
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# Step result
# ---------------------------------------------------------------------------

@dataclass
class StepResult:
    name: str
    status: str          # 'ok' | 'error' | 'skipped'
    duration_ms: int
    error: Optional[str] = None
    data: Optional[Any] = None


# ---------------------------------------------------------------------------
# Recipe run result
# ---------------------------------------------------------------------------

@dataclass
class RecipeResult:
    recipe_name: str
    steps: List[StepResult] = field(default_factory=list)
    total_ms: int = 0

    @property
    def ok(self) -> bool:
        return all(s.status != 'error' for s in self.steps)

    @property
    def failed_step(self) -> Optional[StepResult]:
        return next((s for s in self.steps if s.status == 'error'), None)

    def summary(self) -> str:
        lines = [f"Recipe '{self.recipe_name}': {'OK' if self.ok else 'FAILED'} ({self.total_ms}ms)"]
        for s in self.steps:
            icon = '✓' if s.status == 'ok' else ('✗' if s.status == 'error' else '—')
            err = f"  → {s.error}" if s.error else ""
            lines.append(f"  {icon} {s.name} ({s.duration_ms}ms){err}")
        return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Checkpoint store (optional file-based persistence)
# ---------------------------------------------------------------------------

class CheckpointStore:
    """Simple JSON file checkpoint store for recipe resume support."""

    def __init__(self, path: str) -> None:
        self._path = Path(path)

    def save(self, recipe_name: str, completed_steps: List[str]) -> None:
        data = {"recipe": recipe_name, "completed": completed_steps, "ts": time.time()}
        self._path.write_text(json.dumps(data, indent=2))

    def load(self, recipe_name: str) -> List[str]:
        if not self._path.exists():
            return []
        try:
            data = json.loads(self._path.read_text())
            if data.get("recipe") == recipe_name:
                return data.get("completed", [])
        except Exception:
            pass
        return []

    def clear(self, recipe_name: str) -> None:
        if self._path.exists():
            data = {}
            try:
                data = json.loads(self._path.read_text())
            except Exception:
                pass
            if data.get("recipe") == recipe_name:
                self._path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Recipe (sync)
# ---------------------------------------------------------------------------

class Recipe:
    """Sequential step executor bound to a single browser session.

    Use this class with sync ``Session`` instances.  If you pass an async step
    function (``async def``), ``run()`` raises ``TypeError`` immediately so the
    bug is caught loudly rather than silently treating the coroutine object as a
    successful return value.  For async sessions use :class:`AsyncRecipe`.

    Args:
        session: A ``Session`` instance from agentmb.
        name: Human-readable recipe name (used for checkpointing).
        checkpoint: Optional path to a JSON checkpoint file. If set, completed
                    steps are persisted so the recipe can resume after failure.
        stop_on_error: If True (default), halt execution on the first error.
    """

    def __init__(
        self,
        session: Any,
        name: str = "recipe",
        checkpoint: Optional[str] = None,
        stop_on_error: bool = True,
    ) -> None:
        self._session = session
        self.name = name
        self._steps: List[Dict[str, Any]] = []
        self._checkpoint = CheckpointStore(checkpoint) if checkpoint else None
        self.stop_on_error = stop_on_error

    def step(self, name: str) -> Callable:
        """Decorator — register a function as a named recipe step.

        The decorated function must be a regular (sync) function that receives
        the session as its first argument::

            @recipe.step("my_step")
            def my_step(session):
                session.navigate("https://example.com")

        Raises:
            TypeError: at *run* time if an async function is registered as a
                step.  Use :class:`AsyncRecipe` for async step functions.
        """
        def decorator(fn: Callable) -> Callable:
            self._steps.append({"name": name, "fn": fn})
            return fn
        return decorator

    def add_step(self, name: str, fn: Callable) -> "Recipe":
        """Add a step programmatically (alternative to the @step decorator)."""
        self._steps.append({"name": name, "fn": fn})
        return self

    def run(self) -> RecipeResult:
        """Execute all registered steps sequentially.

        Returns a :class:`RecipeResult` containing per-step outcomes.
        If *checkpoint* was set, completed steps are persisted and the run
        can be resumed by calling ``run()`` again — already-completed steps
        are skipped.

        Raises:
            TypeError: If a registered step is an async function.  Wrap the
                recipe in :class:`AsyncRecipe` and ``await recipe.run()``
                instead.
        """
        result = RecipeResult(recipe_name=self.name)
        completed: List[str] = self._checkpoint.load(self.name) if self._checkpoint else []
        t_start = time.time()

        for step_def in self._steps:
            step_name: str = step_def["name"]
            fn: Callable = step_def["fn"]

            if step_name in completed:
                result.steps.append(StepResult(name=step_name, status='skipped', duration_ms=0))
                continue

            t0 = time.time()
            try:
                data = fn(self._session)
                # Detect un-awaited coroutines — fail loudly so bugs don't hide.
                if inspect.iscoroutine(data):
                    data.close()  # prevent ResourceWarning
                    raise TypeError(
                        f"Step '{step_name}' is an async function. "
                        "Use AsyncRecipe (and await recipe.run()) for async step functions."
                    )
                duration_ms = int((time.time() - t0) * 1000)
                result.steps.append(StepResult(name=step_name, status='ok', duration_ms=duration_ms, data=data))
                completed.append(step_name)
                if self._checkpoint:
                    self._checkpoint.save(self.name, completed)
            except Exception as exc:
                duration_ms = int((time.time() - t0) * 1000)
                result.steps.append(StepResult(
                    name=step_name, status='error', duration_ms=duration_ms, error=str(exc)
                ))
                if self.stop_on_error:
                    break

        result.total_ms = int((time.time() - t_start) * 1000)

        # Clear checkpoint on full success
        if result.ok and self._checkpoint:
            self._checkpoint.clear(self.name)

        return result


# ---------------------------------------------------------------------------
# AsyncRecipe (async)
# ---------------------------------------------------------------------------

class AsyncRecipe:
    """Async sequential step executor bound to a single async browser session.

    Use this class with ``AsyncSession`` instances and ``async def`` step
    functions.  Both sync and async step functions are accepted; sync functions
    are called directly, async functions are awaited.

    Args:
        session: An ``AsyncSession`` instance from agentmb.
        name: Human-readable recipe name (used for checkpointing).
        checkpoint: Optional path to a JSON checkpoint file.
        stop_on_error: If True (default), halt execution on the first error.

    Example::

        recipe = AsyncRecipe(async_session, name="my-workflow")

        @recipe.step("fetch")
        async def fetch(s):
            await s.navigate("https://example.com")

        result = await recipe.run()
        print(result.summary())
    """

    def __init__(
        self,
        session: Any,
        name: str = "recipe",
        checkpoint: Optional[str] = None,
        stop_on_error: bool = True,
    ) -> None:
        self._session = session
        self.name = name
        self._steps: List[Dict[str, Any]] = []
        self._checkpoint = CheckpointStore(checkpoint) if checkpoint else None
        self.stop_on_error = stop_on_error

    def step(self, name: str) -> Callable:
        """Decorator — register a sync or async function as a named step."""
        def decorator(fn: Callable) -> Callable:
            self._steps.append({"name": name, "fn": fn})
            return fn
        return decorator

    def add_step(self, name: str, fn: Callable) -> "AsyncRecipe":
        """Add a step programmatically."""
        self._steps.append({"name": name, "fn": fn})
        return self

    async def run(self) -> RecipeResult:
        """Execute all registered steps sequentially, awaiting async steps."""
        result = RecipeResult(recipe_name=self.name)
        completed: List[str] = self._checkpoint.load(self.name) if self._checkpoint else []
        t_start = time.time()

        for step_def in self._steps:
            step_name: str = step_def["name"]
            fn: Callable = step_def["fn"]

            if step_name in completed:
                result.steps.append(StepResult(name=step_name, status='skipped', duration_ms=0))
                continue

            t0 = time.time()
            try:
                data = fn(self._session)
                if inspect.iscoroutine(data):
                    data = await data
                duration_ms = int((time.time() - t0) * 1000)
                result.steps.append(StepResult(name=step_name, status='ok', duration_ms=duration_ms, data=data))
                completed.append(step_name)
                if self._checkpoint:
                    self._checkpoint.save(self.name, completed)
            except Exception as exc:
                duration_ms = int((time.time() - t0) * 1000)
                result.steps.append(StepResult(
                    name=step_name, status='error', duration_ms=duration_ms, error=str(exc)
                ))
                if self.stop_on_error:
                    break

        result.total_ms = int((time.time() - t_start) * 1000)

        if result.ok and self._checkpoint:
            self._checkpoint.clear(self.name)

        return result
