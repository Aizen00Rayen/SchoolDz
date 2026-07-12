<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\TenantScope;
use Illuminate\Http\Request;

/**
 * Shared list/show/update/delete behavior for every tenant-owned entity —
 * mirrors the _list_scoped/_get_scoped/_update_scoped/_delete_scoped helpers
 * from the original FastAPI backend's routes.py, reused across every router
 * there. Concrete controllers set $model and override store()/applyFilters().
 */
abstract class TenantScopedApiController extends Controller
{
    protected string $model;

    protected array $protectedFields = ['id', 'tenant_id', 'created_at'];

    protected function applyFilters($query, Request $request): void
    {
        //
    }

    public function index(Request $request)
    {
        $query = TenantScope::apply(($this->model)::query(), $request->user());
        $this->applyFilters($query, $request);
        $items = $query->orderByDesc('created_at')->limit(500)->get();

        return response()->json(['items' => $items, 'total' => $items->count()]);
    }

    protected function findOrFail(Request $request, string $id)
    {
        $item = TenantScope::apply(($this->model)::query(), $request->user())->where('id', $id)->first();
        if (! $item) {
            abort(404, 'Not found');
        }

        return $item;
    }

    public function show(Request $request, string $id)
    {
        return response()->json($this->findOrFail($request, $id));
    }

    public function update(Request $request, string $id)
    {
        $item = $this->findOrFail($request, $id);
        $updates = collect($request->all())->except($this->protectedFields)->toArray();
        $item->update($updates);

        return response()->json($item->fresh());
    }

    public function destroy(Request $request, string $id)
    {
        $item = $this->findOrFail($request, $id);
        $item->delete();

        return response()->json(['ok' => true]);
    }
}
