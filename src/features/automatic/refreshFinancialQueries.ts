import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../shared/api/finance";

export async function refreshFinancialQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["monthly-items"] }),
    queryClient.invalidateQueries({ queryKey: ["actual-entries"] }),
    queryClient.invalidateQueries({ queryKey: ["month-analytics"] }),
    queryClient.invalidateQueries({ queryKey: ["month-preview"] }),
    queryClient.invalidateQueries({ queryKey: ["automatic-occurrences"] }),
    queryClient.invalidateQueries({ queryKey: ["special-projects"] }),
    queryClient.invalidateQueries({ queryKey: ["special-project"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.existingMonths }),
    queryClient.invalidateQueries({ queryKey: queryKeys.historyAnalytics }),
    queryClient.invalidateQueries({ queryKey: queryKeys.budgetProjection }),
  ]);
}
