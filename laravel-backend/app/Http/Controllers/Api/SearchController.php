<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Course;
use App\Models\Group;
use App\Models\Guardian;
use App\Models\Payment;
use App\Models\Student;
use App\Models\Teacher;
use Illuminate\Http\Request;

class SearchController extends Controller
{
    public function __invoke(Request $request)
    {
        $request->validate(['q' => 'required|string|min:1']);
        $tid = $request->user()->tenant_id;
        if (! $tid) {
            return response()->json(['results' => []]);
        }

        $q = $request->query('q');
        $like = "%$q%";
        $results = [];

        foreach (Student::where('tenant_id', $tid)
            ->where(fn ($w) => $w->where('first_name', 'like', $like)->orWhere('last_name', 'like', $like)->orWhere('email', 'like', $like))
            ->limit(5)->get() as $s) {
            $results[] = ['type' => 'student', 'id' => $s->id, 'label' => trim("{$s->first_name} {$s->last_name}"), 'data' => $s];
        }

        foreach (Teacher::where('tenant_id', $tid)
            ->where(fn ($w) => $w->where('first_name', 'like', $like)->orWhere('last_name', 'like', $like)->orWhere('email', 'like', $like))
            ->limit(5)->get() as $t) {
            $results[] = ['type' => 'teacher', 'id' => $t->id, 'label' => trim("{$t->first_name} {$t->last_name}"), 'data' => $t];
        }

        foreach (Guardian::where('tenant_id', $tid)
            ->where(fn ($w) => $w->where('name', 'like', $like)->orWhere('email', 'like', $like))
            ->limit(5)->get() as $p) {
            $results[] = ['type' => 'parent', 'id' => $p->id, 'label' => $p->name, 'data' => $p];
        }

        foreach (Course::where('tenant_id', $tid)->where('title', 'like', $like)->limit(5)->get() as $c) {
            $results[] = ['type' => 'course', 'id' => $c->id, 'label' => $c->title, 'data' => $c];
        }

        foreach (Group::where('tenant_id', $tid)->where('name', 'like', $like)->limit(5)->get() as $g) {
            $results[] = ['type' => 'group', 'id' => $g->id, 'label' => $g->name, 'data' => $g];
        }

        foreach (Payment::where('tenant_id', $tid)->where('invoice_number', 'like', $like)->limit(5)->get() as $p) {
            $results[] = ['type' => 'payment', 'id' => $p->id, 'label' => "{$p->invoice_number} — {$p->amount}", 'data' => $p];
        }

        return response()->json(['results' => $results, 'query' => $q]);
    }
}
