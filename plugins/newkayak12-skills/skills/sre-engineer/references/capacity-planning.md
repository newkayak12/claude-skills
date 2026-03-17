# Capacity Planning

## Capacity Planning Automation

```python
# capacity_planner.py - Automated capacity planning
from dataclasses import dataclass
from datetime import datetime, timedelta
import numpy as np

@dataclass
class CapacityMetrics:
    """Historical capacity metrics."""
    timestamp: datetime
    requests_per_second: float
    cpu_utilization: float
    memory_utilization: float

class CapacityPlanner:
    """Automated capacity planning and forecasting."""

    def __init__(self, metrics: list[CapacityMetrics]):
        self.metrics = metrics

    def forecast_growth(self, days_ahead: int = 90) -> dict:
        """Forecast resource usage growth.

        Uses linear regression on historical data.
        """
        # Extract time series
        timestamps = [(m.timestamp - self.metrics[0].timestamp).days
                      for m in self.metrics]
        cpu_values = [m.cpu_utilization for m in self.metrics]
        mem_values = [m.memory_utilization for m in self.metrics]

        # Fit linear trend
        cpu_trend = np.polyfit(timestamps, cpu_values, deg=1)
        mem_trend = np.polyfit(timestamps, mem_values, deg=1)

        # Forecast
        future_day = timestamps[-1] + days_ahead
        cpu_forecast = np.polyval(cpu_trend, future_day)
        mem_forecast = np.polyval(mem_trend, future_day)

        return {
            'days_ahead': days_ahead,
            'cpu_forecast': min(cpu_forecast, 1.0),
            'memory_forecast': min(mem_forecast, 1.0),
            'cpu_threshold_breach': cpu_forecast > 0.8,
            'memory_threshold_breach': mem_forecast > 0.8,
        }

    def recommend_scaling(self, forecast: dict) -> str:
        """Recommend scaling action based on forecast."""
        if forecast['cpu_threshold_breach'] or forecast['memory_threshold_breach']:
            return f"SCALE UP: Forecast shows >80% utilization in {forecast['days_ahead']} days"

        return "OK: No scaling needed"

# Example usage
historical_metrics = [
    CapacityMetrics(
        timestamp=datetime.now() - timedelta(days=30),
        requests_per_second=1000,
        cpu_utilization=0.45,
        memory_utilization=0.50,
    ),
    CapacityMetrics(
        timestamp=datetime.now() - timedelta(days=15),
        requests_per_second=1200,
        cpu_utilization=0.55,
        memory_utilization=0.60,
    ),
    CapacityMetrics(
        timestamp=datetime.now(),
        requests_per_second=1500,
        cpu_utilization=0.65,
        memory_utilization=0.70,
    ),
]

planner = CapacityPlanner(historical_metrics)
forecast = planner.forecast_growth(days_ahead=90)
recommendation = planner.recommend_scaling(forecast)

print(f"90-day forecast: CPU={forecast['cpu_forecast']:.1%}, Memory={forecast['memory_forecast']:.1%}")
print(recommendation)
```
