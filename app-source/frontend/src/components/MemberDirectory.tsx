import React, { useState, useEffect, useCallback } from 'react';
import { getMembers, Member } from '../api/members.js';
import { RoleBadge } from './RoleBadge.js';
import { AddMemberModal } from './AddMemberModal.js';
import { MemberDetailModal } from './MemberDetailModal.js';
import { strings } from '../i18n/mr.js';
import {
  Users,
  UserPlus,
  Search,
  X,
  ChevronRight,
  ChevronLeft,
  Phone,
  Calendar,
  Loader2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

interface MemberDirectoryProps {
  mandalName?: string;
  mandalCode?: string;
}

export const MemberDirectory: React.FC<MemberDirectoryProps> = ({
  mandalName = '',
  mandalCode = '',
}) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [limit] = useState<number>(10);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  // Debounce search input (350ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1); // Reset to page 1 on new search
    }, 350);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load members from real API
  const fetchMembersList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMembers(page, limit, statusFilter, debouncedSearch);
      if (res.success && res.data) {
        setMembers(res.data);
        if (res.pagination) {
          setTotalCount(res.pagination.total);
          setTotalPages(res.pagination.totalPages || 1);
        } else {
          setTotalCount(res.data.length);
          setTotalPages(1);
        }
      } else {
        setError(res.error || 'माहिती आणण्यात अडचण आली.');
      }
    } catch {
      setError(strings.errors.networkError);
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchMembersList();
  }, [fetchMembersList]);

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('mr-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  // Calculate display range
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, totalCount);

  return (
    <div className="space-y-3 pb-6">
      {/* Prominent Add Member Button */}
      <button
        onClick={() => setIsAddModalOpen(true)}
        className="w-full py-3 px-4 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-[0.98] text-white font-bold rounded-2xl text-xs shadow-md shadow-orange-600/20 flex items-center justify-center gap-2 transition-all"
      >
        <UserPlus className="w-4 h-4 text-white" />
        <span>{strings.members.addMemberButton}</span>
      </button>

      {/* Directory Card */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
        {/* Title Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 leading-tight">
                {strings.members.directoryTitle}
              </h3>
              <span className="text-[11px] text-slate-400">
                एकूण: <strong className="text-slate-700">{totalCount}</strong> सदस्य
              </span>
            </div>
          </div>

          <button
            onClick={fetchMembersList}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="रीफ्रेश करा"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative flex items-center">
          <div className="absolute left-3 text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={strings.members.searchPlaceholder}
            className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status Filter Tabs */}
        <div className="flex bg-slate-100 p-0.5 rounded-xl text-xs font-semibold">
          {(['all', 'active', 'inactive'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => {
                setStatusFilter(filter);
                setPage(1);
              }}
              className={`flex-1 py-1.5 rounded-lg transition-all text-center ${
                statusFilter === filter
                  ? 'bg-white text-orange-600 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              {filter === 'all' && strings.members.filters.all}
              {filter === 'active' && strings.members.filters.active}
              {filter === 'inactive' && strings.members.filters.inactive}
            </button>
          ))}
        </div>

        {/* Error State */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span className="flex-1">{error}</span>
            <button
              onClick={fetchMembersList}
              className="underline text-[11px] font-bold text-red-800"
            >
              पुन्हा प्रयत्न
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
            <Loader2 className="w-7 h-7 animate-spin text-orange-600" />
            <span className="text-xs font-medium">{strings.members.loading}</span>
          </div>
        ) : members.length === 0 ? (
          /* Empty State */
          <div className="py-10 text-center space-y-1 text-slate-400">
            <Users className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-semibold text-slate-600">
              {debouncedSearch
                ? strings.members.noSearchResults
                : strings.members.emptyList}
            </p>
            {debouncedSearch && (
              <button
                onClick={() => setSearchTerm('')}
                className="text-[11px] text-orange-600 font-bold underline mt-1"
              >
                शोध रद्द करा
              </button>
            )}
          </div>
        ) : (
          /* Member List Cards */
          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.id}
                onClick={() => setSelectedMember(member)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer active:scale-[0.99] flex items-center justify-between gap-2.5 ${
                  member.isActive
                    ? 'bg-slate-50 hover:bg-slate-100/80 border-slate-200'
                    : 'bg-slate-100/50 hover:bg-slate-100 border-slate-200 opacity-65'
                }`}
              >
                {/* Avatar with Initials */}
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                    member.role === 'PRESIDENT'
                      ? 'bg-amber-100 text-amber-800'
                      : member.role === 'TREASURER'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {member.fullName.slice(0, 2)}
                </div>

                {/* Member Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-800 truncate">
                      {member.fullName}
                    </span>
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        member.isActive ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                      title={member.isActive ? 'सक्रिय' : 'निष्क्रिय'}
                    ></span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                    <span className="flex items-center gap-0.5 font-mono">
                      <Phone className="w-3 h-3 text-slate-400" />
                      +91 {member.phone}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {formatDate(member.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Role Badge & Arrow */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <RoleBadge role={member.role} className="scale-90 origin-right" />
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Real Pagination Controls */}
        {totalCount > 0 && (
          <div className="pt-2 border-t border-slate-100 flex flex-col min-[360px]:flex-row min-[360px]:items-center justify-between gap-2 text-xs text-slate-600">
            <span className="text-[11px] font-medium text-slate-500 text-center min-[360px]:text-left">
              {rangeStart}–{rangeEnd} {strings.members.paginationOf} <strong>{totalCount}</strong> सदस्य
            </span>

            <div className="flex items-center justify-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold flex items-center gap-0.5 hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                aria-label="मागील पान"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>{strings.members.paginationPrev}</span>
              </button>

              <span className="px-2 text-[11px] font-bold text-slate-700">
                {page}/{totalPages}
              </span>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold flex items-center gap-0.5 hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                aria-label="पुढील पान"
              >
                <span>{strings.members.paginationNext}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Member Modal */}
      <AddMemberModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onMemberCreated={() => {
          setPage(1);
          fetchMembersList();
        }}
      />

      {/* Member Detail Modal */}
      <MemberDetailModal
        member={selectedMember}
        mandalName={mandalName}
        mandalCode={mandalCode}
        isOpen={Boolean(selectedMember)}
        onClose={() => setSelectedMember(null)}
        onStatusChanged={() => {
          fetchMembersList();
        }}
      />
    </div>
  );
};
