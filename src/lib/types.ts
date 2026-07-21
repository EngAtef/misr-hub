export type Role = "admin" | "manager" | "viewer";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  is_owner?: boolean;
  created_at: string;
}

export interface Order {
  order_number: string;
  customer_id: string | null;
  awb_number: string | null;
  erp_sales_order_number: string | null;
  order_date: string | null;
  shipping_date: string | null;
  delivery_date: string | null;
  delivery_status: string | null;
  order_status: string | null;
  payment_method: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_cart_amount: number | null;
  total_order_amount: number | null;
  online_paid_amount: number | null;
  total_cash_amount: number | null;
  cod_amount: number | null;
  promo_amount: number | null;
  city: string | null;
  area: string | null;
  district: string | null;
  full_address: string | null;
  customer_notes: string | null;
  admin_notes: string | null;
  cancellation_reason: string | null;
  cancellation_note: string | null;
  source: string | null;
  applied_offer: string | null;
  applied_promotion: string | null;
  campaign_id: string | null;
  customer_rating: number | null;
  driver_rating: number | null;
  items_count: number | null;
}

export interface OrderItem {
  order_number: string;
  position: number;
  product_name: string | null;
  sku: string | null;
  price: number | null;
}

// fn_category_buyers — buyer aggregates within selected categories
export interface CategoryBuyer {
  customer_key: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  city: string | null;
  orders_count: number;
  units: number | null;
  spend: number | null;
  categories: string[] | null;
  first_order: string | null;
  last_order: string | null;
}

export interface OrderEvent {
  order_number: string;
  seq: number;
  state_name: string | null;
  admin_name: string | null;
  state_date: string | null;
}

export interface Kpis {
  total_orders: number;
  gross_revenue: number;
  net_revenue: number;
  delivered_orders: number;
  cancelled_orders: number;
  returned_orders: number;
  in_progress_orders: number;
  cod_orders: number;
  cod_amount: number;
  online_paid_amount: number;
  avg_order_value: number;
  unique_customers: number;
  avg_customer_rating: number | null;
  avg_driver_rating: number | null;
  avg_delivery_days: number | null;
}

export interface BreakdownRow {
  label: string;
  orders: number;
  revenue: number;
  delivered: number;
  cancelled_or_returned: number;
}

export interface DayRow {
  day: string;
  orders: number;
  revenue: number;
  delivered: number;
  cancelled: number;
}
